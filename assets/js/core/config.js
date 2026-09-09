/**
 * core/config.js
 * Deployment settings that are not code — the things you change when
 * the site moves, not when the page changes.
 *
 * The values themselves live in `.env`, which is gitignored.
 * `node tools/build-env.mjs` turns that into `core/env.js`; this file
 * reads that module and hands the rest of the page plain constants, so
 * no other file knows where the settings came from.
 *
 * A browser has no secrets. Everything here ships inside the page and
 * is readable by anyone who opens it, so only values that are safe to
 * expose belong in `.env` under the `CHEEKO_PUBLIC_` prefix — which is
 * the only prefix the generator will publish. A real secret stays
 * unprefixed in `.env` for the backend, and never appears here.
 */

/**
 * `env.js` is generated, so a fresh clone will not have it yet. A
 * static import would take the whole page down in that case; loading it
 * dynamically means a missing file costs only the settings, and every
 * consumer below falls back to an empty value and says so out loud.
 *
 * The top-level await is what keeps this file's exports plain
 * constants: importers of `config.js` wait for it, and read the
 * finished values.
 */
async function loadEnv() {
  try {
    const module = await import("./env.js");
    return module.ENV ?? {};
  } catch (error) {
    console.error(
      "assets/js/core/env.js is missing or failed to load, so sign-in and "
      + "the support form are switched off. Generate it with "
      + "`node tools/build-env.mjs` (copy .env.example to .env first).",
      error,
    );
    return {};
  }
}

const ENV = await loadEnv();

/**
 * Relays the Contact Support form to the Cheeko support inbox.
 *
 * To get the key: go to https://web3forms.com, enter the inbox
 * address (hello@altio.me), and the key arrives by email. Put it in
 * `.env` as CHEEKO_PUBLIC_WEB3FORMS_ACCESS_KEY.
 *
 * The key is submit-only — it can post a form to that one inbox and do
 * nothing else. While it is empty the support form reports a send
 * failure instead of pretending the message went out.
 */
export const WEB3FORMS_ACCESS_KEY = ENV.WEB3FORMS_ACCESS_KEY || "";

/**
 * Firebase project that backs Sign in / Sign up — project "cheekoai".
 *
 * These values are public by design: they ship inside every Firebase
 * web app and identify the project rather than authorise anything. What
 * actually guards the project is the Authorised domains list in
 * Firebase Console → Authentication → Settings, plus security rules on
 * any database you add later. See the README before deploying to a new
 * domain.
 */
export const FIREBASE_CONFIG = {
  apiKey: ENV.FIREBASE_API_KEY || "",
  authDomain: ENV.FIREBASE_AUTH_DOMAIN || "",
  projectId: ENV.FIREBASE_PROJECT_ID || "",
  storageBucket: ENV.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: ENV.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: ENV.FIREBASE_APP_ID || "",
  // Only used if Analytics is switched on — see the README.
  measurementId: ENV.FIREBASE_MEASUREMENT_ID || "",
};

/**
 * The three hosts the parent-account API runs on, mirroring the Parent
 * App's `api_config_service.dart`.
 *
 * Which one is actually used is not decided here — that is
 * `core/api-environment.js`, which layers a runtime override on top of
 * `API_ENV`. This module only reports what `.env` said.
 *
 * A trailing slash is stripped so callers can always join paths with a
 * leading one. An empty entry means that environment is unavailable.
 */
export const API_BASE_URLS = {
  production:  trimUrl(ENV.API_BASE_URL_PRODUCTION),
  development: trimUrl(ENV.API_BASE_URL_DEVELOPMENT),
  local:       trimUrl(ENV.API_BASE_URL_LOCAL),
};

/**
 * Which of the above `.env` asks for: "production", "development",
 * "local", or empty for the localStorage stand-in.
 *
 * Deliberately un-defaulted here. The app falls back to production when
 * nothing is set; this page must not, because production's CORS
 * allowlist does not include it yet and a browser sent there fails with
 * an opaque "Failed to fetch". Unset means the stand-in, which always
 * works — see `core/api-environment.js`.
 */
export const API_ENV = (ENV.API_ENV || "").trim().toLowerCase();

function trimUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}
