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

/** Load the module at `query` and report what it resolved to. */
async function resolveAt(context, query = "") {
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(`${ORIGIN}/harness${query}`);
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

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`));
  process.exit(1);
}
