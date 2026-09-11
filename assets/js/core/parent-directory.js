/**
 * core/parent-directory.js
 * Who has a Cheeko parent account, and what is on it.
 *
 * This is the page's one door to the backend, and it goes to the same
 * place the Parent App does: the mobile parent API, on whichever of the
 * three hosts `core/api-environment.js` resolved. Both clients read and
 * write the same record, so a parent who registers on the phone is a
 * returning parent here, and one who registers here is already set up
 * when they open the app.
 *
 * It mirrors the app's `lib/services/profile_api_service.dart`
 * deliberately closely — same two routes, same Bearer token, same
 * snake_case body, same 401-retry — because divergence between the two
 * clients shows up as data the other one cannot read.
 *
 *   GET  {base}/toy/api/mobile/parent-profile
 *          200 -> the profile          404 -> no account yet
 *   POST {base}/toy/api/mobile/parent-profile
 *          201 -> the profile it created
 *
 * WHY A LOOKUP, NOT `isNewUser`
 * Firebase can hand back `getAdditionalUserInfo(cred).isNewUser`, but
 * that describes the Firebase *auth record*, which the popup creates on
 * the spot for any unknown Google address. A parent who registered on
 * the phone months ago and is signing in here for the first time gets a
 * brand-new Firebase record on this project only if the projects
 * differ — and, worse, a parent who abandoned this form has a record
 * and no account. Only the stored profile is an honest answer.
 *
 * THREE ANSWERS, NOT TWO
 * The app learned this the hard way — see the comment on
 * `UserStateAvailability` in its `user_state_service.dart`. "No such
 * account" and "could not reach the server" must never collapse into
 * one result: reading a 500 or a timeout as "new parent" walks a
 * registered parent into signing up for a second account. So this
 * module resolves `null` only for a real 404, and throws for
 * everything else.
 */

import { PARENT_API_BASE_URL } from "./api-environment.js";
import { getIdToken } from "./firebase.js";
import { storage } from "./storage.js";

/**
 * The two rows a Cheeko account is made of, and the two paths that
 * write them. Registering means writing BOTH.
 *
 *   user-state       the account-existence record: `onboarding_completed`,
 *                    `current_stage`. This is what the Parent App reads
 *                    on every launch to decide where to send someone.
 *   parent-profile   the human details: name, phone, language, consent.
 *
 * Writing only the profile leaves a half-account: the app's launch
 * check reads a 404 from user-state, calls the parent brand new, and
 * sends them to its profile setup form — which always POSTs, hits the
 * profile row that already exists, and dead-ends on an error with no
 * way forward. See `createParentProfile`.
 */
const PROFILE_PATH = "/toy/api/mobile/parent-profile";
const USER_STATE_PATH = "/toy/api/mobile/user-state";

/**
 * Matches the app's `kBackendRequestTimeout`. Without a cap, a backend
 * that accepts the connection and never answers parks the request until
 * the OS gives up — minutes — and the card waiting on it cannot tell
 * that anything is wrong.
 */
const READ_TIMEOUT_MS = 12_000;

/** The app allows a write slightly longer than a read. */
const WRITE_TIMEOUT_MS = 15_000;

/**
 * Which terms text the parent is agreeing to, recorded with their
 * consent. Must match `LegalDocuments.termsVersion` in the Parent App —
 * bump both together when the terms change.
 */
const TERMS_VERSION = "2025-07-28";

/**
 * The app's defaults for a newly registered parent
 * (`_notificationPreferences` in its parent_profile_setup_screen).
 * Sent so an account created here starts out identical to one created
 * on the phone.
 */
const DEFAULT_NOTIFICATION_PREFERENCES = { push: true, email: false, sms: false };

/** Where the local stand-in keeps its profiles. See `isBackendLive`. */
const LOCAL_PROFILES_KEY = "cheeko_parent_profiles";

/**
 * Raised when the question could not be answered. `status` is the HTTP
 * status where there was one, 0 for a timeout or a network failure.
 *
 * Never thrown for a 404 — that is an answer, and comes back as `null`.
 */
export class ParentDirectoryError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message);
    this.name = "ParentDirectoryError";
    this.status = status;
    this.cause = cause;
  }
}

/**
 * True when this page is talking to a real API. False switches on the
 * localStorage stand-in below.
 *
 * Which of the three hosts — and whether any at all — is
 * `core/api-environment.js`'s decision, not this module's.
 */
export const isBackendLive = Boolean(PARENT_API_BASE_URL);

/* ==============================================================
   Reading the API's reply

   The app's `ParentProfile.fromJson` accepts the record in three
   shapes — bare, wrapped in `data`, and in either snake_case or
   camelCase — because the profile reaches it through both the Node
   and the Java backends. The same tolerance is cheaper than finding
   out the hard way which one answered.
   ============================================================== */

/** First key present out of `names`, else undefined. */
function pick(record, ...names) {
  const key = names.find((name) => record?.[name] !== undefined && record[name] !== null);
  return key === undefined ? undefined : record[key];
}

const asText = (value) => (value === undefined || value === null ? "" : String(value));

/**
 * Normalise the API's record into the shape this page reads. Fields the
 * backend omits come back as safe empty values rather than `undefined`,
 * so no caller needs a guard.
 */
function toProfile(payload) {
  // Some routes answer `{ data: { … } }`, some answer the record itself.
  const record = (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data))
    ? payload.data
    : (payload ?? {});

  return {
    id:      asText(pick(record, "id")),
    userId:  asText(pick(record, "userId", "user_id", "supabaseUserId")),
    // `parent_name` is what the app posts; the others are what the two
    // backends have been seen to return it as.
    name:    asText(pick(record, "fullName", "full_name", "parent_name", "display_name")),
    email:   asText(pick(record, "email")),
    // Stored in full E.164 form, dial code included — "+919876543210".
    phone:   asText(pick(record, "phoneNumber", "phone_number")),
    countryRegion: asText(pick(record, "countryRegion", "country_region")),
    // A code, not a label: "en", "hi", "kn", "ml".
    language: asText(pick(record, "preferredLanguage", "preferred_language")) || "en",
    timezone: asText(pick(record, "timezone")) || "UTC",
    marketingOptIn: pick(record, "marketingOptIn", "marketing_opt_in") === true,
    onboardingCompleted: pick(record, "onboardingCompleted", "onboarding_completed") === true,
    createdAt: asText(pick(record, "createdAt", "created_at")),
  };
}

/**
 * Is this profile actually usable, or just a row?
 *
 * The app's own rule, from `ParentProfile.isProfileComplete`: a name
 * and a phone number, both present and non-empty. The backend will
 * happily create a row without them — its `createParentProfile` stores
 * `phone_number: data.phoneNumber || ''` — so a 200 is not on its own
 * proof that anyone ever filled the form in.
 *
 * The app routes an incomplete profile back to its setup screen. This
 * page does the same, rather than showing an account modal with a blank
 * phone number.
 */
export function isProfileComplete(profile) {
  return Boolean(profile?.name?.trim() && profile?.phone?.trim());
}

/* ==============================================================
   Remote implementation — the real API
   ============================================================== */

async function authHeaders({ forceRefresh = false } = {}) {
  const token = await getIdToken({ forceRefresh });
  if (!token) {
    throw new ParentDirectoryError("No signed-in parent to look up.", { status: 401 });
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/** Read the body once, as JSON where it is JSON. */
async function readBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A gateway's HTML error page, most likely.
    return { message: text.slice(0, 200) };
  }
}

/**
 * Send one request under a timeout, retrying once with a force-refreshed
 * token if the backend rejects the one we had.
 *
 * The retry is the app's `_sendWithFreshTokenRetry`, including its
 * quirk: this backend sometimes reports an expired token as a 200 whose
 * body carries `code: 401`, so the body is checked as well as the
 * status.
 */
async function send(path, { method, body, timeoutMs }) {
  async function attempt(forceRefresh) {
    const headers = await authHeaders({ forceRefresh });

    // AbortSignal.timeout is not in older Safari; build it by hand.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${PARENT_API_BASE_URL}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      return { response, payload: await readBody(response) };
    } finally {
      clearTimeout(timer);
    }
  }

  const rejectedToken = ({ response, payload }) =>
    response.status === 401 || payload?.code === 401;

  try {
    const first = await attempt(false);
    if (!rejectedToken(first)) return first;

    console.warn("Parent API rejected the token; retrying with a fresh one.");
    return await attempt(true);
  } catch (error) {
    if (error instanceof ParentDirectoryError) throw error;

    // An abort is our timeout firing; anything else here is the network
    // or CORS. Neither says a thing about whether the account exists.
    const timedOut = error?.name === "AbortError";
    if (!timedOut) explainUnreachable(error, path);

    throw new ParentDirectoryError(
      timedOut
        ? `The parent API did not answer within ${timeoutMs / 1000}s.`
        : `Could not reach the parent API: ${error?.message || error}`,
      { cause: error },
    );
  }
}

/**
 * Say why a request never became a response.
 *
 * A cross-origin request the API's allowlist does not name is refused
 * by the browser before anything is sent, and `fetch` reports that as a
 * bare `TypeError: Failed to fetch` — no status, no body, byte for byte
 * what a dead server looks like. Every minute spent debugging that is a
 * minute spent on the wrong thing, so guess out loud: name the origin,
 * the host, and the two ways out.
 *
 * A guess is all it is. The browser deliberately withholds the reason,
 * so this reads "likely" rather than stating it, and never replaces the
 * real error — which is still thrown, and still logged by the caller.
 */
function explainUnreachable(error, path) {
  if (error?.name !== "TypeError") return;

  let origin = "this page";
  try {
    origin = window.location.origin;
  } catch { /* no location to read */ }

  console.error(
    `The parent API at ${PARENT_API_BASE_URL}${path} did not answer `
    + `${origin} at all — no status, no body.\n`
    + `The likeliest cause by far is CORS: the API answers a browser `
    + `only from an origin on its allowlist, and a refused preflight is `
    + `reported to JavaScript exactly like a network failure.\n`
    + `Either add ${origin} to that allowlist server-side, or point this `
    + `page at a host that already allows it — append ?api=production, `
    + `?api=development or ?api=local to the URL, or ?api=standin to work `
    + `with no backend. See the README's CORS section.`,
    error,
  );
}

/**
 * Turn a non-OK reply into an error carrying the server's own reason.
 *
 * This backend words it `msg` — an unauthenticated read answers
 * `{"code":401,"msg":"Invalid or expired Firebase token","data":null}` —
 * with `message` and `error` accepted too, since the same page talks to
 * whichever of the two backends is in front of it.
 */
function toError(response, payload) {
  return new ParentDirectoryError(
    payload?.msg || payload?.message || payload?.error
      || `Parent API responded ${response.status}`,
    { status: response.status },
  );
}

async function fetchRemoteProfile() {
  const { response, payload } = await send(PROFILE_PATH, {
    method: "GET",
    timeoutMs: READ_TIMEOUT_MS,
  });

  if (response.status === 200) return toProfile(payload);

  // The whole point of the lookup: a signed-in parent with no account.
  // Only a 404 means that. A 401, a 5xx, a gateway page — none of those
  // tell us anything about the account, so none may be read as "new".
  if (response.status === 404) return null;

  throw toError(response, payload);
}

/**
 * Create the account-existence row, before the profile row.
 *
 * Idempotent on the server — its `createUserState` reads the row first
 * and returns it if one is already there — so a parent who abandoned
 * this form and came back reaches this call a second time harmlessly.
 * 409 is treated as success for the same reason: the row existing is
 * the state we were asking for.
 *
 * The body carries the email only for parity with the app. The server
 * takes the authoritative address from the verified token
 * (`req.user.email`) and ignores what the browser sent.
 *
 * A failure here is fatal to the registration on purpose. Carrying on
 * to write the profile is what produces the half-account this call
 * exists to prevent, so the parent is told to retry instead.
 */
async function ensureUserState(email) {
  const { response, payload } = await send(USER_STATE_PATH, {
    method: "POST",
    body: JSON.stringify({ email: (email || "").toLowerCase() }),
    timeoutMs: WRITE_TIMEOUT_MS,
  });

  if (response.status === 200 || response.status === 201 || response.status === 409) {
    return;
  }

  throw toError(response, payload);
}

/**
 * Write the profile row: POST for a parent with no row, PUT for one
 * whose row exists but was never filled in.
 *
 * The app always POSTs — its registration screen is only ever reached
 * by someone it believes is new — and that is exactly how it dead-ends
 * on an incomplete profile. Choosing the verb from the lookup we
 * already did is deterministic, and does not depend on guessing whether
 * a collision comes back as 409 or 500.
 */
async function writeRemoteProfile(registration, { hasExistingRow }) {
  if (hasExistingRow) return updateRemoteProfile(registration);

  const { response, payload } = await send(PROFILE_PATH, {
    method: "POST",
    body: JSON.stringify(buildCreateBody(registration)),
    timeoutMs: WRITE_TIMEOUT_MS,
  });

  // The app accepts 201 only; 200 is allowed here because an idempotent
  // re-POST is the kinder answer to a parent who double-submitted.
  if (response.status === 201 || response.status === 200) return toProfile(payload);

  // Registered on another device between the lookup and this submit, so
  // the row appeared underneath us. Finish the job as an update rather
  // than reporting a collision the parent cannot act on.
  if (response.status === 409) return updateRemoteProfile(registration);

  throw toError(response, payload);
}

/**
 * Fill in a profile row that already exists.
 *
 * The field set is the app's `updateParentProfile` exactly — including
 * its `push_notifications` / `email_notifications` mirrors of the
 * preferences map, which the backend stores as separate columns.
 *
 * The consent timestamps are deliberately NOT sent here. They are part
 * of the create body, which is verified against the app field for
 * field; adding them to an update would be inventing a shape neither
 * client uses. A row reaching this path already carries the consent
 * recorded when it was created.
 */
async function updateRemoteProfile(registration) {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  const { response, payload } = await send(PROFILE_PATH, {
    method: "PUT",
    body: JSON.stringify({
      parent_name: registration.name,
      phone_number: registration.phone,
      country_region: registration.countryRegion,
      preferred_language: registration.language,
      ...(registration.timezone ? { timezone: registration.timezone } : {}),
      notification_preferences: preferences,
      push_notifications: preferences.push === true,
      email_notifications: preferences.email === true,
      marketing_opt_in: registration.marketingOptIn,
    }),
    timeoutMs: WRITE_TIMEOUT_MS,
  });

  if (response.status === 200) return toProfile(payload);
  throw toError(response, payload);
}

/**
 * The POST body, field for field as the Parent App builds it in
 * `ProfileApiService.buildCreateParentProfileBody`. Any drift here is
 * an account the app reads differently from the one it created.
 */
function buildCreateBody({
  name, email, phone, countryRegion, language, marketingOptIn, acceptedAt, timezone,
}) {
  return {
    parent_name: name,
    ...(email ? { email } : {}),
    phone_number: phone,
    country_region: countryRegion,
    preferred_language: language,
    // Omitted rather than sent as null when the browser cannot name its
    // zone: the backend reads a stored null as UTC, and posting one
    // would overwrite a good value with that fallback.
    ...(timezone ? { timezone } : {}),
    // One timestamp for all three, as the app does — they were all
    // agreed to by the same tap on Continue.
    consent_accepted_at: acceptedAt,
    privacy_policy_accepted_at: acceptedAt,
    terms_accepted_at: acceptedAt,
    terms_version: TERMS_VERSION,
    marketing_opt_in: marketingOptIn,
    notification_preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  };
}

/* ==============================================================
   Local stand-in — no API environment resolved

   Keeps profiles in localStorage, keyed by Firebase uid, so both
   "new parent" and "returning parent" are reachable with no backend
   at all: register once and you are a returning parent from then on.

   It deliberately does NOT model the user-state row. Nothing on this
   page reads it — it exists for the Parent App's launch check — and a
   fake copy here would only be fidelity nobody can observe. That the
   real path writes it is covered by tests/auth-flow.test.mjs, which
   asserts the call and its order.
   Useful while the API's CORS allowlist does not yet include the
   domain this page is served from, which is a server-side change.

   Async, and speaking the same profile shape, so swapping the real
   API back in changes no call site.
   ============================================================== */

function readLocalProfiles() {
  try {
    return JSON.parse(storage.get(LOCAL_PROFILES_KEY) || "{}");
  } catch {
    // Hand-edited or half-written — start over rather than wedge sign-in.
    return {};
  }
}

function writeLocalProfiles(profiles) {
  storage.set(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
}

async function fetchLocalProfile(user) {
  const stored = readLocalProfiles()[user.uid];
  return stored ? toProfile(stored) : null;
}

async function createLocalProfile(user, registration) {
  const profiles = readLocalProfiles();

  // Stored in the API's own shape — snake_case, the record as the
  // backend would hold it — and normalised on the way out, exactly as
  // a real reply is. Storing the normalised shape instead would run it
  // through `toProfile` twice, and the second pass finds none of the
  // keys it looks for: the name and language come back empty and the
  // returning parent is greeted as "Parent" speaking English.
  const record = {
    id: user.uid,
    user_id: user.uid,
    ...buildCreateBody(registration),
    email: registration.email || user.email || "",
    onboarding_completed: false,
    created_at: new Date().toISOString(),
  };

  profiles[user.uid] = record;
  writeLocalProfiles(profiles);
  return toProfile(record);
}

/**
 * Forget a locally stored profile, so the next sign-in with the same
 * Google account is treated as a new parent again.
 *
 * Only touches the stand-in — deleting a real account is
 * `DELETE /toy/api/mobile/account`, which belongs to the app and is
 * deliberately not something this page can do. Exposed for walking the
 * new-parent path more than once while testing.
 */
export function forgetLocalProfile(uid) {
  if (isBackendLive) return false;
  const profiles = readLocalProfiles();
  if (!(uid in profiles)) return false;
  delete profiles[uid];
  writeLocalProfiles(profiles);
  return true;
}

/* ==============================================================
   The interface the page uses
   ============================================================== */

/**
 * Does this Firebase user have a Cheeko parent account?
 *
 * Resolves with the profile, or `null` for a parent who has never
 * registered — `null` is an answer, not a failure. Rejects when the
 * question could not be asked, which the caller must not read as
 * "new parent".
 */
export async function fetchParentProfile(user) {
  if (!user?.uid) return null;
  return isBackendLive ? fetchRemoteProfile() : fetchLocalProfile(user);
}

/**
 * Register a parent account from the form.
 *
 * `registration` is `{ name, email, phone, countryRegion, language,
 * marketingOptIn }`, where `phone` is already in full E.164 form and
 * `language` is one of the codes the app uses. The consent timestamp
 * and timezone are stamped here so every caller records them the same
 * way. `hasExistingRow` comes from the lookup that sent the parent to
 * the form: false for a 404, true for a 200 that was incomplete.
 *
 * TWO WRITES, IN THIS ORDER
 * The account-existence row goes first, then the profile. That order is
 * the app's, and it is the order that matters: if the second write
 * fails, the parent is left looking new to both clients and can simply
 * try again. The reverse leaves a profile row with no account row,
 * which is the state that strands them in the app's onboarding.
 *
 * Resolves with the stored profile.
 */
export async function createParentProfile(user, registration, { hasExistingRow = false } = {}) {
  if (!user?.uid) {
    throw new ParentDirectoryError("No signed-in parent to register.", { status: 401 });
  }

  const complete = {
    ...registration,
    email: registration.email || user.email || "",
    acceptedAt: new Date().toISOString(),
    timezone: resolveTimezone(),
  };

  if (!isBackendLive) return createLocalProfile(user, complete);

  await ensureUserState(complete.email);
  return writeRemoteProfile(complete, { hasExistingRow });
}

/* ==============================================================
   The account's toys — the Device Info section
   ============================================================== */

/**
 * The Parent App's own device list: every toy bound to the account,
 * with its board, firmware, modes and last check-in — the same record
 * the admin dashboard shows. Served by every host the app talks to.
 */
const DEVICES_PATH = "/toy/api/mobile/devices?page=1&limit=100";

/**
 * Each toy's warranty, as the backend records it: started on the toy's
 * first activation in the Parent App, never restarted by a rebind.
 * Newer than the device list, so a host can serve the list and answer
 * 404 here — see `fetchAccountDevices`.
 */
const DEVICE_WARRANTY_PATH = "/toy/api/mobile/devices/warranty";

/** The account's children, to name the one each toy is set up for. */
const KIDS_PATH = "/toy/api/mobile/kids";

/** The rows out of whichever wrapper a route used: `{data:{list}}`, `{data:[]}` or a bare array. */
function rowsOf(payload) {
  const found = [payload?.data?.list, payload?.data, payload?.list, payload].find(Array.isArray);
  return found || [];
}

/** A MAC as a comparison key, so "aa:bb:…" and "AA-BB-…" are one toy. */
const macKey = (mac) => asText(mac).replace(/[^0-9a-f]/gi, "").toUpperCase();

/**
 * The rows of a read the section can do without, or `null` when it
 * failed. Logged rather than thrown: the toys are still worth showing,
 * but a silent gap is how a missing deploy goes unnoticed.
 */
function optionalRows(settled, what) {
  if (settled.status === "fulfilled" && settled.value.response.status === 200) {
    return rowsOf(settled.value.payload);
  }
  const reason = settled.status === "rejected"
    ? settled.reason
    : toError(settled.value.response, settled.value.payload);
  console.warn(`Could not read the account's ${what}; showing its devices without them.`, reason);
  return null;
}

/**
 * The Cheeko toys on the signed-in parent's account: each one's
 * details, the child it is set up for, and its warranty.
 *
 * Three reads, in parallel. Only the device list is required — it is
 * the section. The warranty and the children fill it in, and a failure
 * in either leaves those fields empty instead of hiding every toy: a
 * host without the warranty endpoint still answers the list, and
 * `warranty` comes back `null` for the page to word as "not available".
 *
 * Resolves with a list, empty for an account with no toys. Resolves
 * `null` in stand-in mode: there is no server to ask, and inventing a
 * toy would be worse than saying so. Rejects with a ParentDirectoryError
 * when the list itself fails, where `status` 404 means the host does not
 * have the endpoint — the page words that differently from an outage.
 */
export async function fetchAccountDevices() {
  if (!isBackendLive) return null;

  const read = (path) => send(path, { method: "GET", timeoutMs: READ_TIMEOUT_MS });
  const [devices, warranties, kids] = await Promise.allSettled(
    [DEVICES_PATH, DEVICE_WARRANTY_PATH, KIDS_PATH].map(read),
  );

  if (devices.status === "rejected") throw devices.reason;
  const { response, payload } = devices.value;
  if (response.status !== 200) throw toError(response, payload);

  const warrantyRows = optionalRows(warranties, "warranties");
  const warrantyByMac = warrantyRows && new Map(warrantyRows.map((row) =>
    [macKey(pick(row, "macAddress", "mac_address")), row?.warranty]));

  const kidNameById = new Map((optionalRows(kids, "child profiles") || []).map((kid) =>
    [asText(kid?.id), asText(kid?.name).trim() || asText(kid?.nickname).trim()]));

  return rowsOf(payload).map((raw) => toAccountDevice(raw, { warrantyByMac, kidNameById }));
}

/** One toy, in the shape the Device Info section reads. */
function toAccountDevice(raw, { warrantyByMac, kidNameById }) {
  const macAddress = asText(pick(raw, "macAddress", "mac_address"));
  const autoUpdate = pick(raw, "autoUpdate", "auto_update");
  const warranty = warrantyByMac?.get(macKey(macAddress));

  return {
    macAddress,
    name: asText(pick(raw, "deviceName", "device_name", "alias")).trim(),
    kidName: kidNameById.get(asText(pick(raw, "kidId", "kid_id"))) || "",
    board: asText(pick(raw, "board")),
    firmware: asText(pick(raw, "appVersion", "app_version")),
    // Stored as 1/0. Unknown stays null rather than reading as "off".
    otaAutoUpdate: autoUpdate === undefined ? null : autoUpdate === true || Number(autoUpdate) === 1,
    // null when the warranty could not be read, or had no row for this toy.
    warranty: warranty ? toWarranty(warranty) : null,
  };
}

function toWarranty(raw) {
  const registered = raw.registered === true;
  return {
    registered,
    status: asText(raw.status) || (registered ? "active" : "not_registered"),
    start: asText(pick(raw, "warrantyStart", "warranty_start")),
    end: asText(pick(raw, "warrantyEnd", "warranty_end")),
    daysRemaining: Number(raw.daysRemaining) || 0,
  };
}

/**
 * The browser's IANA zone, e.g. "Asia/Kolkata" — the app's
 * `ParentTimezoneSyncService.resolveForSignup`, which exists so an
 * account never spends its first day on the server's UTC fallback and
 * report its day boundary at 05:30 IST.
 *
 * Empty when the browser will not say, in which case the field is left
 * out of the body entirely.
 */
function resolveTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
