/**
 * The localStorage stand-in, which is what an empty
 * CHEEKO_PUBLIC_PARENT_API_BASE_URL switches on. Register once, then
 * sign in again as the same uid and expect to be a returning parent —
 * with no API involved at all.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";
// Persists the session across a reload, as real Firebase does — which
// is the whole point of this test.
const STUB = `
const KEY="__stub_session";
let user = localStorage.getItem(KEY) ? window.__TEST_USER : null;
const L=new Set();
export async function signInWith(){ user=window.__TEST_USER; localStorage.setItem(KEY,"1"); L.forEach(l=>l(user)); return user; }
export async function signOutOfFirebase(){ user=null; localStorage.removeItem(KEY); L.forEach(l=>l(null)); }
export async function getIdToken(){ return user?"t":null; }
export async function watchAuthState(l){ L.add(l); setTimeout(()=>l(user),0); return ()=>L.delete(l); }
`;
// env.js with API_ENV blanked — the only difference. The three host
// URLs are left populated on purpose: it is the selector being empty
// that must switch on the stand-in, not the absence of any URL.
const ENV_EMPTY = `export const ENV = { WEB3FORMS_ACCESS_KEY: "x", FIREBASE_API_KEY: "x",
  FIREBASE_AUTH_DOMAIN: "x", FIREBASE_PROJECT_ID: "x", FIREBASE_STORAGE_BUCKET: "x",
  FIREBASE_MESSAGING_SENDER_ID: "x", FIREBASE_APP_ID: "x", FIREBASE_MEASUREMENT_ID: "x",
  API_BASE_URL_PRODUCTION: "https://ota.cheekoai.in",
  API_BASE_URL_DEVELOPMENT: "https://otadev.cheekoai.in",
  API_BASE_URL_LOCAL: "http://localhost:8002",
  API_ENV: "" };`;
const USER = { uid: "standin-1", email: "sam@example.com", displayName: "Sam Rao" };

const results = [];
const ok = (n, v, d = "") => { results.push(v); console.log(`${v ? "  PASS" : "  FAIL"}  ${n}${d ? `  ${d}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();      // one context, so localStorage persists
const page = await ctx.newPage();
let apiCalls = 0;

await page.route("**/__stub/firebase.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: STUB }));
await page.route(`${ORIGIN}/assets/js/core/env.js`, r => r.fulfill({ status: 200, contentType: "text/javascript", body: ENV_EMPTY }));
// Any host, so a wrongly-resolved environment is caught rather than missed.
await page.route("**/toy/api/mobile/**", r => { apiCalls += 1; return r.abort(); });
await page.route(`${ORIGIN}/index.html`, async (route) => {
  const res = await route.fetch();
  const html = (await res.text()).replace('<script type="module" src="assets/js/main.js"></script>',
    '<script type="importmap">{"imports":{"/assets/js/core/firebase.js":"/__stub/firebase.js"}}</script>\n<script type="module" src="assets/js/main.js"></script>');
  await route.fulfill({ response: res, body: html, headers: { ...res.headers(), "content-length": undefined } });
});
await page.addInitScript(u => { window.__TEST_USER = u; }, USER);

// --- first visit: new parent ---
await page.goto(`${ORIGIN}/index.html`);
await page.waitForFunction(() => document.getElementById("headerAccountBtn")?.textContent);
ok("stand-in is active", await page.evaluate(async () => !(await import("/assets/js/core/parent-directory.js")).isBackendLive));

await page.click("#headerAccountBtn");
await page.click("#authGoogleBtn");
await page.waitForSelector("#authRegisterForm:not(.is-hidden)", { timeout: 5000 });
ok("first visit: asked to register", true);

await page.fill("#registerPhone", "9123456780");
await page.selectOption("#registerLanguage", "kn");
await page.check("#consentGuardian"); await page.check("#consentPrivacy"); await page.check("#consentTerms");
await page.click("#authRegisterSubmit");
await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 5000 });
ok("registered with no backend", true);

// --- reload: returning parent ---
await page.reload();
await page.waitForFunction(() => document.getElementById("headerAccountBtn").textContent === "Profile", { timeout: 5000 });
ok("second visit: signed straight in", await page.textContent("#headerAccountBtn") === "Profile");
ok("registration form not shown again", !(await page.isVisible("#authRegisterForm")));

await page.click("#headerAccountBtn");
await page.waitForSelector("#accountModal.modal--open");
ok("stored name read back", (await page.textContent("#profileName")).trim() === "Sam Rao");
ok("stored phone read back", (await page.textContent("#profilePhone")).trim() === "+919123456780", await page.textContent("#profilePhone"));
ok("stored language read back (row hidden for now)", (await page.textContent("#profileLanguage")).trim() === "Kannada");
ok("the API was never called", apiCalls === 0, `calls=${apiCalls}`);

await browser.close();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
