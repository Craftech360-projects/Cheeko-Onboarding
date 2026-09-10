/**
 * `core/api-environment.js` — which backend the page resolves to.
 *
 * The real module, loaded in a real browser, with only `env.js` swapped
 * so each case can state what `.env` said. A minimal host page is used
 * rather than index.html: the resolver reads `window.location.search`,
 * and this keeps each case to one module evaluation.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";

/** An env.js naming whichever hosts and selector a case needs. */
const envJs = (over = {}) => `export const ENV = ${JSON.stringify({
  WEB3FORMS_ACCESS_KEY: "x",
  FIREBASE_API_KEY: "x", FIREBASE_AUTH_DOMAIN: "x", FIREBASE_PROJECT_ID: "x",
  FIREBASE_STORAGE_BUCKET: "x", FIREBASE_MESSAGING_SENDER_ID: "x",
  FIREBASE_APP_ID: "x", FIREBASE_MEASUREMENT_ID: "x",
  API_BASE_URL_PRODUCTION: "https://ota.cheekoai.in",
  API_BASE_URL_DEVELOPMENT: "https://otadev.cheekoai.in",
  API_BASE_URL_LOCAL: "http://localhost:8002",
  API_ENV: "development",
  ...over,
})};`;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

const browser = await chromium.launch();

/** A context whose env.js is fixed; pages in it share localStorage. */
async function makeContext(envOver = {}) {
  const context = await browser.newContext();
  const warnings = [];
  await context.route(`${ORIGIN}/assets/js/core/env.js`, (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: envJs(envOver) }));
  // A bare host page — same origin, so the module's relative imports resolve.
  await context.route(`${ORIGIN}/harness`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>harness</title>" }));
  return { context, warnings };
}

/** Stands in for core/firebase.js, so a lookup can be attempted with a token. */
const FIREBASE_STUB = `
export async function signInWith() { return null; }
export async function signOutOfFirebase() {}
export async function getIdToken() { return "test-id-token"; }
export async function watchAuthState() { return () => {}; }
`;

/**
 * A context that serves this checkout's real files as if they came from
 * \`origin\` — the live domain, or 127.0.0.1 — with env.js and firebase.js
 * swapped. The resolver branches on \`location.hostname\`, so the page has
 * to genuinely be on that host, not just claim it.
 */
async function makeHostContext(origin, envOver = {}) {
  const context = await browser.newContext();
  await context.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/assets/js/core/env.js") {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: envJs(envOver) });
    }
    if (pathname === "/assets/js/core/firebase.js") {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: FIREBASE_STUB });
    }
    if (pathname === "/harness") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>harness</title>" });
    }
    const response = await route.fetch({ url: `${ORIGIN}${pathname}` });
    return route.fulfill({ response });
  });
  return { context };
}

/** Load the module at `query` and report what it resolved to. */
async function resolveAt(context, query = "", origin = ORIGIN) {
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(`${origin}/harness${query}`);
  const out = await page.evaluate(async () => {
    const m = await import("/assets/js/core/api-environment.js");
    return {
      name: m.API_ENVIRONMENT,
      baseUrl: m.PARENT_API_BASE_URL,
      source: m.API_ENVIRONMENT_SOURCE,
      stored: (() => { try { return localStorage.getItem("cheeko_api_env"); } catch { return null; } })(),
    };
  });
  await page.close();
  return { ...out, logs };
}

/* ---------- .env selects the environment ---------- */
console.log("\n.env selection");
{
  const { context } = await makeContext();
  const dev = await resolveAt(context);
  check("development is the shipped default", dev.name === "development", dev.name);
  check("resolves to the dev host", dev.baseUrl === "https://otadev.cheekoai.in", dev.baseUrl);
  check("reports .env as the source", dev.source === ".env", dev.source);
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "production" });
  const prod = await resolveAt(context);
  check("production selects the production host",
    prod.name === "production" && prod.baseUrl === "https://ota.cheekoai.in", prod.baseUrl);
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "local" });
  const local = await resolveAt(context);
  check("local selects the local host",
    local.name === "local" && local.baseUrl === "http://localhost:8002", local.baseUrl);
  await context.close();
}

/* ---------- the stand-in is a supported state, and the fallback ---------- */
console.log("\nstand-in fallback");
{
  const { context } = await makeContext({ API_ENV: "" });
  const none = await resolveAt(context);
  check("empty API_ENV falls back to the stand-in", none.name === "standin", none.name);
  check("stand-in has no base URL", none.baseUrl === "");
  check("unset is reported as the default, not an error", none.source === "default", none.source);
  check("says so in the console",
    none.logs.some((l) => l.includes("localStorage stand-in")), none.logs.join(" | "));
  await context.close();
}
{
  // Never production: that is the trap this fallback exists to avoid.
  const { context } = await makeContext({ API_ENV: "" });
  const none = await resolveAt(context);
  check("empty API_ENV does NOT fall back to production",
    none.baseUrl !== "https://ota.cheekoai.in", none.baseUrl);
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "development", API_BASE_URL_DEVELOPMENT: "" });
  const empty = await resolveAt(context);
  check("a selected environment with no URL falls back to the stand-in",
    empty.name === "standin", empty.name);
  check("and warns which key is empty",
    empty.logs.some((l) => l.includes("API_BASE_URL_DEVELOPMENT")), empty.logs.join(" | "));
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "staging" });
  const bad = await resolveAt(context);
  check("an unknown API_ENV does not guess a backend", bad.name === "standin", bad.name);
  check("and says what the valid values are",
    bad.logs.some((l) => l.includes("production, development, local")), bad.logs.join(" | "));
  await context.close();
}

/* ---------- the ?api= runtime override ---------- */
console.log("\n?api= override");
{
  const { context } = await makeContext();     // .env says development
  const over = await resolveAt(context, "?api=production");
  check("?api=production overrides .env",
    over.name === "production" && over.baseUrl === "https://ota.cheekoai.in", over.name);
  check("the override is reported as the source", over.source.includes("?api="), over.source);
  check("and is remembered", over.stored === "production", String(over.stored));

  // The whole point: it survives a page without the parameter.
  const sticky = await resolveAt(context);
  check("it sticks on a later page with no parameter",
    sticky.name === "production", sticky.name);

  const cleared = await resolveAt(context, "?api=clear");
  check("?api=clear returns to .env", cleared.name === "development", cleared.name);
  check("and forgets the override", cleared.stored === null, String(cleared.stored));
  await context.close();
}
{
  const { context } = await makeContext();
  const alias = await resolveAt(context, "?api=dev");
  check("?api=dev is accepted as an alias", alias.name === "development", alias.name);
  await context.close();
}
{
  const { context } = await makeContext();     // .env says development
  const stub = await resolveAt(context, "?api=standin");
  check("?api=standin forces the stand-in over a real .env host",
    stub.name === "standin" && stub.baseUrl === "", stub.name);
  await context.close();
}
{
  const { context } = await makeContext();
  const bogus = await resolveAt(context, "?api=nonsense");
  check("an unrecognised ?api= is ignored, .env still wins",
    bogus.name === "development", bogus.name);
  check("and it is not remembered", bogus.stored === null, String(bogus.stored));
  check("and it explains the accepted values",
    bogus.logs.some((l) => l.includes("expected one of")), bogus.logs.join(" | "));
  await context.close();
}

/* ---------- parent-directory reads the same answer ---------- */
console.log("\nwiring");
{
  const { context } = await makeContext({ API_ENV: "development" });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/harness`);
  const live = await page.evaluate(async () => {
    const [dir, env] = await Promise.all([
      import("/assets/js/core/parent-directory.js"),
      import("/assets/js/core/api-environment.js"),
    ]);
    return { isBackendLive: dir.isBackendLive, base: env.PARENT_API_BASE_URL };
  });
  check("parent-directory sees the resolved host as live",
    live.isBackendLive === true && live.base === "https://otadev.cheekoai.in", JSON.stringify(live));
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "" });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/harness`);
  const standin = await page.evaluate(async () =>
    (await import("/assets/js/core/parent-directory.js")).isBackendLive);
  check("and switches to the stand-in when nothing resolved", standin === false);
  await context.close();
}

/* ---------- a deployed page must never fall back to the stand-in ----------
   On localhost the stand-in is a convenience. Anywhere else it is data
   loss: the parent is told they are registered and nothing reaches the
   server. These load the real module as if served from the live domain. */
console.log("\ndeployed host — never an implicit stand-in");
const LIVE = "https://www.cheekoai.in";
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "" });
  const r = await resolveAt(context, "", LIVE);
  check("no API_ENV: NOT the stand-in", r.name !== "standin", r.name);
  check("no API_ENV: resolves to misconfigured", r.name === "misconfigured", r.name);
  check("misconfigured exports a non-empty base URL (empty means stand-in)",
    r.baseUrl !== "", JSON.stringify(r.baseUrl));
  check("and says so out loud",
    r.logs.some((l) => l.startsWith("error:") && l.includes("will NOT fall back")), r.logs.join(" | "));
  check("and does not also claim a parent API is in use",
    !r.logs.some((l) => l.includes("parent API is")), r.logs.join(" | "));
  await context.close();
}
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "staging" });
  const r = await resolveAt(context, "", LIVE);
  check("invalid API_ENV: misconfigured, not the stand-in", r.name === "misconfigured", r.name);
  check("invalid API_ENV: names the bad value", r.logs.some((l) => l.includes('"staging"')), r.logs.join(" | "));
  await context.close();
}
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "development", API_BASE_URL_DEVELOPMENT: "" });
  const r = await resolveAt(context, "", LIVE);
  check("selected environment with no URL: misconfigured", r.name === "misconfigured", r.name);
  check("and names the empty key",
    r.logs.some((l) => l.includes("CHEEKO_PUBLIC_API_BASE_URL_DEVELOPMENT")), r.logs.join(" | "));
  await context.close();
}
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "production", API_BASE_URL_LOCAL: "" });
  const r = await resolveAt(context, "?api=local", LIVE);
  check("?api= override to an environment with no URL: misconfigured", r.name === "misconfigured", r.name);
  await context.close();
}
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "" });
  const r = await resolveAt(context, "?api=standin", LIVE);
  check("explicit ?api=standin is still allowed on a deployed host", r.name === "standin", r.name);
  check("and has no base URL", r.baseUrl === "");
  await context.close();
}
{
  const { context } = await makeHostContext(LIVE, { API_ENV: "production" });
  const r = await resolveAt(context, "", LIVE);
  check("a correctly configured deploy is unaffected",
    r.name === "production" && r.baseUrl === "https://ota.cheekoai.in", `${r.name} ${r.baseUrl}`);
  await context.close();
}
{
  // The point of the state: registering must fail, not quietly land in
  // browser storage.
  const { context } = await makeHostContext(LIVE, { API_ENV: "" });
  const page = await context.newPage();
  const sent = [];
  page.on("request", (req) => sent.push(req.url()));
  await page.goto(`${LIVE}/harness`);
  const out = await page.evaluate(async () => {
    const dir = await import("/assets/js/core/parent-directory.js");
    const user = { uid: "live-uid-1", email: "parent@example.com" };
    const attempt = async (fn) => {
      try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, name: error.name }; }
    };
    const lookup = await attempt(() => dir.fetchParentProfile(user));
    const register = await attempt(() => dir.createParentProfile(user, {
      name: "Parent", email: user.email, phone: "+919812345678",
      countryRegion: "IN", language: "en", marketingOptIn: false,
    }));
    return {
      isBackendLive: dir.isBackendLive,
      lookup, register,
      stored: localStorage.getItem("cheeko_parent_profiles"),
    };
  });
  check("misconfigured: parent-directory does not treat it as the stand-in", out.isBackendLive === true);
  check("misconfigured: the lookup fails instead of answering 'new parent'",
    out.lookup.ok === false && out.lookup.name === "ParentDirectoryError", JSON.stringify(out.lookup));
  check("misconfigured: registration fails instead of pretending to succeed",
    out.register.ok === false && out.register.name === "ParentDirectoryError", JSON.stringify(out.register));
  check("misconfigured: nothing was written to the browser stand-in", out.stored === null, String(out.stored));
  const apiRequests = sent.filter((url) => /^https?:\/\/[^/]+\/toy\/api\/mobile\//.test(url));
  check("misconfigured: no request left the page for any API host",
    apiRequests.length === 0, apiRequests.join(", "));
  await page.close();
  await context.close();
}

/* ---------- local hosts keep today's behaviour ---------- */
console.log("\nlocal hosts — stand-in fallback unchanged");
{
  const { context } = await makeHostContext("http://127.0.0.1:3000", { API_ENV: "" });
  const r = await resolveAt(context, "", "http://127.0.0.1:3000");
  check("127.0.0.1, no API_ENV: still the stand-in", r.name === "standin" && r.source === "default", `${r.name} ${r.source}`);
  await context.close();
}
{
  const { context } = await makeHostContext("http://127.0.0.1:3000", { API_ENV: "development", API_BASE_URL_DEVELOPMENT: "" });
  const r = await resolveAt(context, "", "http://127.0.0.1:3000");
  check("127.0.0.1, no URL: still the stand-in", r.name === "standin", r.name);
  await context.close();
}
{
  const { context } = await makeContext({ API_ENV: "" });
  const r = await resolveAt(context);
  check("localhost, no API_ENV: still the stand-in", r.name === "standin" && r.baseUrl === "", r.name);
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
