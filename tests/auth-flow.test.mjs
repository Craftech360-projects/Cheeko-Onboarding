/**
 * Drives the real onboarding page through the new-parent and
 * returning-parent flows.
 *
 * Only `core/firebase.js` is replaced, via an import map injected into
 * index.html, so `features/parent-auth.js`, `core/parent-directory.js`
 * and `core/app-state.js` are the shipped files running unmodified.
 * The parent-profile API is intercepted, which is what lets the tests
 * assert the exact request the page makes.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";
/**
 * Matched by path across any host. Which of the three the page resolved
 * is `core/api-environment.js`'s decision and is asserted in
 * `smoke.test.mjs` — pinning a host here would just break this file
 * every time CHEEKO_PUBLIC_API_ENV changes.
 */
const API_GLOB = "**/toy/api/mobile/**";

/** Strips host and prefix, leaving "/parent-profile" or "/user-state". */
const pathOf = (request) =>
  new URL(request.url()).pathname.replace("/toy/api/mobile", "");

const STUB_FIREBASE = `
let user = null;
const listeners = new Set();
function notify() { listeners.forEach((l) => l(user)); }
export async function signInWith() {
  user = window.__TEST_USER;
  notify();
  return user;
}
export async function signOutOfFirebase() { user = null; notify(); }
export async function getIdToken() { return user ? "test-id-token" : null; }
export async function watchAuthState(listener) {
  listeners.add(listener);
  // Firebase calls back once with the restored session (none) on load.
  setTimeout(() => listener(user), 0);
  return () => listeners.delete(listener);
}
`;

/**
 * A 404 on the profile lookup is the "new parent" answer, and every
 * browser logs a 4xx fetch to the console. Expected, so it is not an
 * error the tests should fail on — anything else is.
 */
const EXPECTED_NOISE = [
  /http 404: .*\/toy\/api\/mobile\/parent-profile/,
  /Failed to load resource: the server responded with a status of 404/,
];
const realErrors = (lines) =>
  lines.filter((line) => !EXPECTED_NOISE.some((pattern) => pattern.test(line)));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

/** A page with Firebase stubbed and the API under the test's control. */
async function openPage(browser, { onApi, user }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (r) => consoleErrors.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    // Which resource, so a deliberately mocked 404 is distinguishable
    // from a genuinely missing file.
    if (r.status() >= 400) consoleErrors.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.route("**/__stub/firebase.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: STUB_FIREBASE }));

  await page.route(`${ORIGIN}/index.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '<script type="module" src="assets/js/main.js"></script>',
      '<script type="importmap">'
      + JSON.stringify({ imports: { "/assets/js/core/firebase.js": "/__stub/firebase.js" } })
      + '</script>\n  <script type="module" src="assets/js/main.js"></script>',
    );
    await route.fulfill({ response, body: html, headers: { ...response.headers(), "content-length": undefined } });
  });

  if (onApi) await page.route(API_GLOB, onApi);

  // The Device Info section asks for the account's toys, their warranty
  // and its children whenever Firebase reports a user. Those calls are not
  // what these tests are about, so they get their own route — registered
  // last, so it wins — and stay out of the request logs the assertions
  // above count. tests/device-info.test.mjs covers them.
  await page.route(
    (url) => /^\/toy\/api\/mobile\/(devices(\/warranty)?|kids)$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: [] }) }),
  );

  await page.addInitScript((u) => { window.__TEST_USER = u; }, user);
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => document.getElementById("headerAccountBtn")?.textContent?.length > 0);

  return { context, page, consoleErrors };
}

const NEW_USER = { uid: "uid-new-001", email: "alex.johnson@gmail.com", displayName: "Alex Johnson" };
const OLD_USER = { uid: "uid-old-002", email: "priya.menon@gmail.com", displayName: "Priya Menon" };

const browser = await chromium.launch();

/* ============================================================
   1. NEW PARENT — lookup 404, register, POST, signed in
   ============================================================ */
console.log("\n1. New parent: no account -> register -> signed in");
{
  const requests = [];
  const { context, page, consoleErrors } = await openPage(browser, {
    user: NEW_USER,
    onApi: async (route) => {
      const request = route.request();
      const path = pathOf(request);
      requests.push({
        path,
        method: request.method(),
        auth: request.headers().authorization,
        contentType: request.headers()["content-type"],
        body: request.postData() ? JSON.parse(request.postData()) : null,
      });

      // The account-existence row, written before the profile.
      if (path === "/user-state") {
        return route.fulfill({ status: 201, contentType: "application/json",
          body: JSON.stringify({ user_id: NEW_USER.uid, email: NEW_USER.email, current_stage: "email_verification" }) });
      }

      if (request.method() === "GET") {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Profile not found" }) });
      }
      const posted = JSON.parse(request.postData() || "{}");
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "row-77", user_id: NEW_USER.uid, parent_name: posted.parent_name,
          email: posted.email, phone_number: posted.phone_number,
          country_region: posted.country_region, preferred_language: posted.preferred_language,
          timezone: posted.timezone, marketing_opt_in: posted.marketing_opt_in,
          onboarding_completed: false, created_at: "2026-09-09T12:00:00Z",
        }),
      });
    },
  });

  check("header starts as Sign in", await page.textContent("#headerAccountBtn") === "Sign in");

  await page.click("#headerAccountBtn");
  check("auth card opens on the provider choice", await page.isVisible("#authChoose"));

  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });

  const notice = (await page.textContent("#authNotice")).trim();
  check("says the account does not exist",
    notice.includes("could not find a Cheeko account") && notice.includes(NEW_USER.email),
    `notice: "${notice}"`);
  check("title switches to the app's wording",
    await page.textContent("#authModalTitle") === "Welcome to Cheeko");
  check("subtitle matches the app",
    (await page.textContent("#authSubtitle")).includes("ready to go"));
  check("provider buttons are hidden", !(await page.isVisible("#authChoose")));
  check("email is shown, not asked for",
    (await page.textContent("#authRegisterEmail")).trim() === NEW_USER.email);
  check("name is prefilled from Google",
    await page.inputValue("#registerName") === "Alex Johnson");
  check("still signed out until registered",
    await page.textContent("#headerAccountBtn") === "Sign in");
  check("Continue starts disabled", await page.isDisabled("#authRegisterSubmit"));

  // --- which consent rows are on screen ---
  // The three required ones are hidden for now; only the optional
  // marketing box is shown.
  const visibleConsents = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".auth-card__consents li"))
      .filter((row) => !row.classList.contains("is-hidden"))
      .map((row) => row.querySelector("input").id));
  check("only the marketing consent is shown",
    JSON.stringify(visibleConsents) === JSON.stringify(["consentMarketing"]),
    JSON.stringify(visibleConsents));

  // --- gating ---
  await page.fill("#registerPhone", "98765432");
  check("Continue disabled on a short number", await page.isDisabled("#authRegisterSubmit"));

  await page.fill("#registerPhone", "9876543210");
  check("Continue enables on name + number alone, with the ticks hidden",
    await page.isEnabled("#authRegisterSubmit"));

  await page.evaluate(() => { document.getElementById("registerName").value = ""; });
  await page.dispatchEvent("#registerName", "input");
  check("an empty name still blocks Continue", await page.isDisabled("#authRegisterSubmit"));
  await page.fill("#registerName", "Alex Johnson");
  check("and filling it back in re-enables Continue", await page.isEnabled("#authRegisterSubmit"));

  // The requirement follows the markup: un-hide a row and it gates
  // again, with no JS change. This is what makes restoring the consent
  // boxes a one-class edit.
  await page.evaluate(() =>
    document.getElementById("consentTerms").closest("li").classList.remove("is-hidden"));
  await page.dispatchEvent("#registerName", "input");
  check("un-hiding a required row restores its gate",
    await page.isDisabled("#authRegisterSubmit"));
  await page.check("#consentTerms");
  check("ticking the restored row satisfies it again",
    await page.isEnabled("#authRegisterSubmit"));
  await page.evaluate(() => {
    const box = document.getElementById("consentTerms");
    box.checked = false;
    box.closest("li").classList.add("is-hidden");
  });
  await page.dispatchEvent("#registerName", "input");
  check("re-hiding it drops the requirement again",
    await page.isEnabled("#authRegisterSubmit"));

  await page.selectOption("#registerLanguage", "hi");
  await page.check("#consentMarketing");

  await page.click("#authRegisterSubmit");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 5000 });

  check("auth card closes once registered", !(await page.isVisible("#authRegisterForm")));
  check("header becomes Profile", await page.textContent("#headerAccountBtn") === "Profile");
  check("and its icon shows the signed-in dot",
    (await page.getAttribute("#headerAccountBtn", "class")).includes("account-button--signed-in"));

  // --- the request the page actually made ---
  const get = requests.find((r) => r.path === "/parent-profile" && r.method === "GET");
  const post = requests.find((r) => r.path === "/parent-profile" && r.method === "POST");
  const state = requests.find((r) => r.path === "/user-state");

  check("looked the parent up before registering", Boolean(get));
  check("lookup carries the Firebase bearer token", get?.auth === "Bearer test-id-token");
  check("registered with POST", Boolean(post));
  check("POST carries the bearer token", post?.auth === "Bearer test-id-token");
  check("POST is JSON", post?.contentType === "application/json");

  /* --- the account-existence row ---
     Without this the Parent App's launch check reads a 404 from
     user-state, calls the parent brand new, and dead-ends its own
     always-POST profile form on the row this page already wrote. */
  check("wrote the user-state row", Boolean(state));
  check("user-state was POSTed", state?.method === "POST");
  check("user-state carries the bearer token", state?.auth === "Bearer test-id-token");
  check("user-state body carries the lowercased email",
    state?.body?.email === NEW_USER.email.toLowerCase(), JSON.stringify(state?.body));
  check("user-state was written BEFORE the profile",
    requests.indexOf(state) < requests.indexOf(post),
    requests.map((r) => `${r.method} ${r.path}`).join(" -> "));
  check("no PUT on a brand-new account",
    !requests.some((r) => r.method === "PUT"),
    requests.map((r) => `${r.method} ${r.path}`).join(" -> "));

  const b = post?.body || {};
  check("parent_name is the typed name", b.parent_name === "Alex Johnson", JSON.stringify(b.parent_name));
  check("email is the Google address", b.email === NEW_USER.email);
  check("phone_number is E.164 with the dial code", b.phone_number === "+919876543210", JSON.stringify(b.phone_number));
  check("country_region is the ISO code", b.country_region === "IN", JSON.stringify(b.country_region));
  check("preferred_language is the code, not the label", b.preferred_language === "hi", JSON.stringify(b.preferred_language));
  check("marketing_opt_in reflects the optional box", b.marketing_opt_in === true);
  check("terms_version matches the app", b.terms_version === "2025-07-28", JSON.stringify(b.terms_version));
  check("timezone is a real IANA zone", typeof b.timezone === "string" && b.timezone.includes("/"), JSON.stringify(b.timezone));
  check("notification_preferences matches the app's defaults",
    JSON.stringify(b.notification_preferences) === JSON.stringify({ push: true, email: false, sms: false }),
    JSON.stringify(b.notification_preferences));
  const stamps = [b.consent_accepted_at, b.privacy_policy_accepted_at, b.terms_accepted_at];
  check("all three consents are stamped with one timestamp",
    stamps.every((t) => typeof t === "string" && !Number.isNaN(Date.parse(t)))
    && new Set(stamps).size === 1, JSON.stringify(stamps));
  check("consent is recorded as timestamps, not booleans",
    b.consentGuardian === undefined && b.consents === undefined);

  // --- the details now on screen ---
  await page.click("#headerAccountBtn");
  await page.waitForSelector("#accountModal.modal--open");
  check("account modal shows the registered name", (await page.textContent("#profileName")).trim() === "Alex Johnson");
  check("account modal shows the email", (await page.textContent("#profileEmail")).trim() === NEW_USER.email);
  check("account modal shows the phone", (await page.textContent("#profilePhone")).trim() === "+919876543210");
  // The row is hidden in the markup for now, so this checks the code ->
  // label mapping and that it is ready to show, not that it is visible.
  check("language code is mapped to its label", (await page.textContent("#profileLanguage")).trim() === "Hindi");
  check("the language row is hidden for now", !(await page.isVisible("#profileLanguage")));

  // Only three rows are meant to be on screen; the rest are hidden
  // until there is something real behind them.
  // The name heads the card; the rows under it are the rest.
  const visibleRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#accountModal .profile-card__field"))
      .filter((row) => row.offsetParent !== null)
      .map((row) => row.querySelector(".profile-card__label").textContent.trim()));
  check("the account modal shows name, email and phone only",
    (await page.isVisible("#profileName"))
    && JSON.stringify(visibleRows) === JSON.stringify(["Email", "Phone"]),
    JSON.stringify(visibleRows));
  check("its avatar shows the parent's initials",
    (await page.textContent("#profileAvatar")).trim() === "AJ", await page.textContent("#profileAvatar"));
  check("its title is plain text, no emoji",
    (await page.textContent("#accountModalTitle")).trim() === "Manage Account",
    await page.textContent("#accountModalTitle"));

  check("no unexpected console errors",
    realErrors(consoleErrors).length === 0, realErrors(consoleErrors).join(" | "));
  await context.close();
}

/* ============================================================
   2. RETURNING PARENT — lookup 200, straight in
   ============================================================ */
console.log("\n2. Returning parent: account exists -> signed straight in");
{
  const requests = [];
  const { context, page, consoleErrors } = await openPage(browser, {
    user: OLD_USER,
    onApi: async (route) => {
      requests.push(route.request().method());
      if (route.request().method() !== "GET") return route.fulfill({ status: 500, body: "{}" });
      // Wrapped in `data`, camelCase — one of the shapes the app tolerates.
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ data: {
          id: "row-12", userId: OLD_USER.uid, fullName: "Priya Menon",
          email: OLD_USER.email, phoneNumber: "+919812345678",
          countryRegion: "IN", preferredLanguage: "ml", timezone: "Asia/Kolkata",
          marketingOptIn: false, onboardingCompleted: true,
          createdAt: "2026-03-02T09:10:00Z",
        } }),
      });
    },
  });

  // The wizard advances off the account step only for a parent who has
  // actually reached it; one still on step 1 must not be yanked forward.
  await page.click('[data-wizard-next="2"]');
  await page.waitForFunction(() => localStorage.getItem("cheeko_onboard_step") === "2");

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 5000 });

  check("never shown the registration form", !(await page.isVisible("#authRegisterForm")));
  check("auth card closed itself", !(await page.isVisible("#authModal.modal--open")));
  check("header becomes Profile", await page.textContent("#headerAccountBtn") === "Profile");
  check("one lookup, no write", JSON.stringify(requests) === JSON.stringify(["GET"]), JSON.stringify(requests));

  await page.click("#headerAccountBtn");
  await page.waitForSelector("#accountModal.modal--open");
  check("shows the stored name from the API", (await page.textContent("#profileName")).trim() === "Priya Menon");
  check("shows the stored email", (await page.textContent("#profileEmail")).trim() === OLD_USER.email);
  check("shows the stored phone", (await page.textContent("#profilePhone")).trim() === "+919812345678");
  check("stored language is mapped to its label", (await page.textContent("#profileLanguage")).trim() === "Malayalam");

  // Onboarding step 2 is "create a parent account" — being registered completes it.
  const step = await page.evaluate(() => localStorage.getItem("cheeko_onboard_step"));
  check("onboarding advanced past the account step", Number(step) >= 3, `step=${step}`);

  check("no unexpected console errors",
    realErrors(consoleErrors).length === 0, realErrors(consoleErrors).join(" | "));
  await context.close();
}

/* ============================================================
   3. LOOKUP FAILED — must not be read as "new parent"
   ============================================================ */
console.log("\n3. Backend down: neither signed in nor asked to register");
{
  let posts = 0;
  const { context, page } = await openPage(browser, {
    user: OLD_USER,
    onApi: async (route) => {
      if (route.request().method() === "POST") posts += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "upstream failure" }) });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authError:not(.is-hidden)", { timeout: 8000 });

  check("registration form NOT shown on a failed lookup", !(await page.isVisible("#authRegisterForm")));
  check("not signed in on a failed lookup", await page.textContent("#headerAccountBtn") === "Sign in");
  check("told to retry", (await page.textContent("#authError")).includes("could not check your Cheeko account"));
  check("nothing was written", posts === 0);
  check("provider buttons usable again", await page.isEnabled("#authGoogleBtn"));
  await context.close();
}

/* ============================================================
   4. A 404 body that is not JSON must still mean "new parent"
   ============================================================ */
console.log("\n4. 404 with a gateway HTML body still means new parent");
{
  const { context, page } = await openPage(browser, {
    user: NEW_USER,
    onApi: (route) => route.request().method() === "GET"
      ? route.fulfill({ status: 404, contentType: "text/html", body: "<html><body>Not Found</body></html>" })
      : route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ parent_name: "X" }) }),
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });
  check("register form shown", await page.isVisible("#authRegisterForm"));
  await context.close();
}

/* ============================================================
   5. Expired token: 401 once, then the refreshed token works
   ============================================================ */
console.log("\n5. Stale token: one 401, then the refreshed token succeeds");
{
  let gets = 0;
  const { context, page } = await openPage(browser, {
    user: OLD_USER,
    onApi: async (route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 500, body: "{}" });
      gets += 1;
      if (gets === 1) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: 401 }) });
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ parent_name: "Priya Menon", email: OLD_USER.email, phone_number: "+919812345678", preferred_language: "en" }) });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 8000 });
  check("retried after the 401 and signed in", gets === 2, `GETs=${gets}`);
  await context.close();
}

/* ============================================================
   6. Sign out clears the session
   ============================================================ */
console.log("\n6. Log out returns the page to signed-out");
{
  const { context, page } = await openPage(browser, {
    user: OLD_USER,
    onApi: (route) => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ parent_name: "Priya Menon", email: OLD_USER.email, phone_number: "+919812345678", preferred_language: "en" }) }),
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 8000 });

  await page.click("#headerAccountBtn");
  await page.waitForSelector("#accountModal.modal--open");
  await page.click("#logoutBtn");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Sign in", { timeout: 5000 });
  check("back to Sign in", await page.textContent("#headerAccountBtn") === "Sign in");
  check("and the signed-in dot is gone",
    !(await page.getAttribute("#headerAccountBtn", "class")).includes("account-button--signed-in"));
  const phone = await page.evaluate(() => localStorage.getItem("cheeko_parent_phone"));
  check("phone number cleared from storage", phone === null, `phone=${phone}`);
  await context.close();
}

/* ============================================================
   7. A 200 whose profile is empty is not a returning parent

   The backend stores `phone_number: data.phoneNumber || ''`, so a row
   can exist with nothing in it. The app calls that incomplete
   (`ParentProfile.isProfileComplete`) and routes back to setup; showing
   an account modal with a blank phone number instead is the bug.

   Finishing such a row is a PUT. A POST would land on the row that
   already exists and dead-end exactly as the app does.
   ============================================================ */
console.log("\n7. Existing but empty profile: finish it with a PUT, not a POST");
{
  const requests = [];
  const { context, page } = await openPage(browser, {
    user: OLD_USER,
    onApi: async (route) => {
      const request = route.request();
      const path = pathOf(request);
      requests.push({ path, method: request.method(), body: request.postData() ? JSON.parse(request.postData()) : null });

      if (path === "/user-state") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });

      if (request.method() === "GET") {
        // The row exists. Nobody ever filled it in.
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ id: "row-3", user_id: OLD_USER.uid, email: OLD_USER.email,
            parent_name: "", phone_number: "", preferred_language: "en" }) });
      }
      if (request.method() === "PUT") {
        const sent = JSON.parse(request.postData() || "{}");
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ parent_name: sent.parent_name, email: OLD_USER.email,
            phone_number: sent.phone_number, preferred_language: sent.preferred_language }) });
      }
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ msg: "POST must not happen here" }) });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });

  check("empty profile is sent to the form, not signed in",
    await page.textContent("#headerAccountBtn") === "Sign in");
  const notice = (await page.textContent("#authNotice")).trim();
  check("notice says details are missing, not that no account exists",
    notice.includes("missing a few details") && !notice.includes("could not find"), `"${notice}"`);

  await page.fill("#registerName", "Priya Menon");
  await page.fill("#registerPhone", "9812345678");
  await page.click("#authRegisterSubmit");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 8000 });

  const verbs = requests.filter((r) => r.path === "/parent-profile").map((r) => r.method);
  check("finished the row with a PUT", verbs.includes("PUT"), verbs.join(","));
  check("never POSTed onto the existing row", !verbs.includes("POST"), verbs.join(","));

  const put = requests.find((r) => r.method === "PUT");
  check("PUT sends the app's update field set",
    put?.body?.parent_name === "Priya Menon" && put?.body?.phone_number === "+919812345678"
    && put?.body?.country_region === "IN" && put?.body?.preferred_language === "en"
    && put?.body?.push_notifications === true && put?.body?.email_notifications === false,
    JSON.stringify(put?.body));
  check("PUT does not invent consent columns",
    put?.body?.consent_accepted_at === undefined && put?.body?.terms_version === undefined);
  check("signed in with the completed details",
    (await page.textContent("#profilePhone")).trim() === "+919812345678");
  await context.close();
}

/* ============================================================
   8. user-state 409 is success, not a failure

   The server's createUserState returns an existing row rather than
   erroring, but a parent who abandoned this form once will legitimately
   reach the call a second time. The row already being there is the
   state we were asking for.
   ============================================================ */
console.log("\n8. user-state 409 (row already there) still registers");
{
  let profileWritten = false;
  const { context, page } = await openPage(browser, {
    user: NEW_USER,
    onApi: async (route) => {
      const path = pathOf(route.request());
      if (path === "/user-state") {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ msg: "already exists" }) });
      }
      if (route.request().method() === "GET") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      profileWritten = true;
      return route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ parent_name: "Alex Johnson", email: NEW_USER.email, phone_number: "+919876543210", preferred_language: "en" }) });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });
  await page.fill("#registerPhone", "9876543210");
  await page.click("#authRegisterSubmit");
  await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 8000 });

  check("409 on user-state did not stop registration", profileWritten);
  check("signed in", await page.textContent("#headerAccountBtn") === "Profile");
  await context.close();
}

/* ============================================================
   9. user-state failing must abort the whole registration

   Carrying on to write the profile is what produces the half-account:
   a profile row with no account row, which strands the parent in the
   app's onboarding with no way forward.
   ============================================================ */
console.log("\n9. user-state 500: nothing is written, the parent can retry");
{
  let profileWritten = false;
  const { context, page } = await openPage(browser, {
    user: NEW_USER,
    onApi: async (route) => {
      const path = pathOf(route.request());
      if (path === "/user-state") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ msg: "upstream failure" }) });
      }
      if (route.request().method() === "GET") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      profileWritten = true;
      return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });
  await page.fill("#registerPhone", "9876543210");
  await page.click("#authRegisterSubmit");
  await page.waitForSelector("#authRegisterError:not(.is-hidden)", { timeout: 8000 });

  check("NO profile row was written", profileWritten === false);
  check("not signed in", await page.textContent("#headerAccountBtn") === "Sign in");
  check("still on the form so it can be retried", await page.isVisible("#authRegisterForm"));
  check("Continue is usable again", await page.isEnabled("#authRegisterSubmit"));
  check("Continue is not stuck on its busy label",
    (await page.textContent("#authRegisterSubmit")).trim() === "Continue");
  await context.close();
}

/* ============================================================
   10. A half-filled row prefills the form from what it has

   Including splitting the stored E.164 number back into the country
   and the local digits — one string on the wire, two controls here.
   ============================================================ */
console.log("\n10. Half-filled row prefills, and splits the stored number");
{
  const { context, page } = await openPage(browser, {
    user: OLD_USER,
    onApi: async (route) => {
      const path = pathOf(route.request());
      if (path === "/user-state") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      // Has a phone and a language, no name — so still incomplete.
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ user_id: OLD_USER.uid, email: OLD_USER.email, parent_name: "",
          phone_number: "+6598765432", country_region: "SG", preferred_language: "kn" }) });
    },
  });

  await page.click("#headerAccountBtn");
  await page.click("#authGoogleBtn");
  await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });

  check("country came from the stored row", await page.inputValue("#registerCountry") === "SG",
    await page.inputValue("#registerCountry"));
  check("dial code was stripped from the local digits",
    await page.inputValue("#registerPhone") === "98765432", await page.inputValue("#registerPhone"));
  check("language came from the stored row", await page.inputValue("#registerLanguage") === "kn");
  check("name fell back to the Google display name",
    await page.inputValue("#registerName") === "Priya Menon", await page.inputValue("#registerName"));
  await context.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`));
  process.exit(1);
}
