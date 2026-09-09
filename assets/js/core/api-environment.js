/**
 * core/api-environment.js
 * Which backend this page talks to, and why.
 *
 * The Parent App has the same job in `api_config_service.dart`: three
 * hosts in `.env`, one of them selected, and a runtime override on top
 * that its Developer Options screen writes. This is that, for a page
 * with no settings screen — the override is a query parameter.
 *
 * PRECEDENCE, highest first
 *   1. `?api=…` in the URL, which is remembered afterwards
 *   2. `localStorage`, from a previous `?api=…`
 *   3. `CHEEKO_PUBLIC_API_ENV` in `.env`
 *   4. nothing — the localStorage stand-in
 *
 * WHY THE FALLBACK IS THE STAND-IN AND NOT PRODUCTION
 * The app defaults to production when nothing is set. Copying that here
 * would be a trap: production's CORS allowlist does not include this
 * site's domain yet, so a browser sent there fails with an opaque
 * `TypeError: Failed to fetch` — no status, no body, nothing to read.
 * Someone who checks out this repo and runs it should get a page that
 * works, and that is the stand-in.
 */

import { API_BASE_URLS, API_ENV } from "./config.js";

/** Where a `?api=…` choice is remembered, so it survives navigation. */
const OVERRIDE_KEY = "cheeko_api_env";

/** The environments `.env` can name. */
export const API_ENVIRONMENTS = ["production", "development", "local"];

/**
 * What someone may type in `?api=…`. Short forms because this gets
 * typed by hand into an address bar; `standin` and its synonyms force
 * the stand-in even when `.env` names a real host.
 */
const ALIASES = {
  production: "production", prod: "production", prd: "production",
  development: "development", dev: "development",
  local: "local", localhost: "local",
  standin: "standin", stub: "standin", none: "standin", off: "standin",
};

/** Values that mean "forget the override and go back to `.env`". */
const CLEAR_VALUES = new Set(["clear", "reset", "default", ""]);

/* --------------------------------------------------------------
   The runtime override
   -------------------------------------------------------------- */

/**
 * Read `?api=…`, act on it, and remember it.
 *
 * Remembering is what makes it useful: the point is to test a deployed
 * build against dev, and that means clicking through pages that will
 * not carry the parameter. `?api=clear` removes it again.
 *
 * Every step is guarded — a page opened as a `file://` URL, a browser
 * with storage blocked, or a malformed URL must cost the setting, not
 * the page.
 */
function readOverride() {
  let requested = null;

  try {
    const raw = new URLSearchParams(window.location.search).get("api");
    if (raw !== null) requested = raw.trim().toLowerCase();
  } catch {
    // No URL to read; fall through to whatever was stored.
  }

  if (requested !== null) {
    if (CLEAR_VALUES.has(requested)) {
      store(OVERRIDE_KEY, null);
      return null;
    }

    const resolved = ALIASES[requested];
    if (resolved) {
      store(OVERRIDE_KEY, resolved);
      return resolved;
    }

    console.warn(
      `Ignoring ?api=${requested} — expected one of `
      + `${API_ENVIRONMENTS.join(", ")}, standin, or clear.`,
    );
  }

  return ALIASES[read(OVERRIDE_KEY)] || null;
}

function read(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function store(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked. The override holds for this page load only.
  }
}

/* --------------------------------------------------------------
   Resolution
   -------------------------------------------------------------- */

function resolve() {
  const override = readOverride();
  const chosen = override || API_ENV;
  const source = override ? "?api= override" : ".env";

  // Nothing asked for at all.
  if (!chosen) {
    return { name: "standin", baseUrl: "", source: "default" };
  }

  // Asked for explicitly, which is a supported state and not a warning.
  if (chosen === "standin") {
    return { name: "standin", baseUrl: "", source };
  }

  if (!API_ENVIRONMENTS.includes(chosen)) {
    console.error(
      `CHEEKO_PUBLIC_API_ENV is "${chosen}", which is not one of `
      + `${API_ENVIRONMENTS.join(", ")}. Falling back to the local `
      + `stand-in rather than guessing which backend you meant.`,
    );
    return { name: "standin", baseUrl: "", source: "invalid" };
  }

  const baseUrl = API_BASE_URLS[chosen];
  if (!baseUrl) {
    console.warn(
      `No URL configured for the "${chosen}" environment `
      + `(CHEEKO_PUBLIC_API_BASE_URL_${chosen.toUpperCase()} is empty), `
      + `so the local stand-in is being used instead.`,
    );
    return { name: "standin", baseUrl: "", source: `${source}, no URL` };
  }

  warnIfMixedContent(baseUrl, chosen);
  return { name: chosen, baseUrl, source };
}

/**
 * An https page cannot call an http URL — the browser blocks it as
 * mixed content, before any request goes out, and the failure looks
 * exactly like the site being down.
 *
 * This is reachable in practice: `local` is plain http, and so is the
 * app's own `MOBILE_API_BASE_URL`. Say so out loud rather than letting
 * it read as a backend problem.
 */
function warnIfMixedContent(baseUrl, name) {
  try {
    if (window.location.protocol === "https:" && baseUrl.startsWith("http://")) {
      console.error(
        `The "${name}" API is ${baseUrl}, but this page is served over `
        + `https. Browsers block plain-http requests from an https page as `
        + `mixed content, so every call will fail before it is sent. Serve `
        + `the page over http for local work, or use an https backend.`,
      );
    }
  } catch {
    // No location to inspect.
  }
}

const resolved = resolve();

/**
 * Base URL of the parent-account API, or `""` for the stand-in.
 * `core/parent-directory.js` reads exactly this.
 */
export const PARENT_API_BASE_URL = resolved.baseUrl;

/** "production" | "development" | "local" | "standin". */
export const API_ENVIRONMENT = resolved.name;

/** Which rule picked it, for the console line and for tests. */
export const API_ENVIRONMENT_SOURCE = resolved.source;

// One line, so "which backend am I on?" is never a guess. The stand-in
// says so loudly because data written there goes nowhere real.
if (API_ENVIRONMENT === "standin") {
  console.info(
    "Cheeko: no backend configured (%s) — using the localStorage stand-in. "
    + "Registrations stay in this browser and reach neither the API nor the "
    + "Parent App.",
    API_ENVIRONMENT_SOURCE,
  );
} else {
  console.info(
    "Cheeko: parent API is %s (%s, from %s).",
    API_ENVIRONMENT, PARENT_API_BASE_URL, API_ENVIRONMENT_SOURCE,
  );
}
