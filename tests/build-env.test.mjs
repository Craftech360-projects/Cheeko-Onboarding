/**
 * `tools/build-env.mjs` — both of its sources.
 *
 * Each case copies the real script into a fresh temporary project, so it
 * runs exactly as shipped (it finds `.env` and writes `env.js` relative
 * to its own location) without touching this checkout's `.env` or
 * `env.js`. The child process gets a clean environment — PATH plus what
 * the case sets — so nothing exported in the shell running the tests can
 * leak into a result.
 *
 * Plain Node: no browser, no server.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../tools/build-env.mjs", import.meta.url));

const FULL_ENV = {
  CHEEKO_PUBLIC_WEB3FORMS_ACCESS_KEY: "web3forms-key",
  CHEEKO_PUBLIC_FIREBASE_API_KEY: "firebase-key",
  CHEEKO_PUBLIC_FIREBASE_AUTH_DOMAIN: "cheekoai.firebaseapp.com",
  CHEEKO_PUBLIC_FIREBASE_PROJECT_ID: "cheekoai",
  CHEEKO_PUBLIC_API_BASE_URL_PRODUCTION: "https://ota.cheekoai.in",
  CHEEKO_PUBLIC_API_BASE_URL_DEVELOPMENT: "https://otadev.cheekoai.in",
  CHEEKO_PUBLIC_API_BASE_URL_LOCAL: "http://localhost:8002",
  CHEEKO_PUBLIC_API_ENV: "production",
};

const roots = [];

/** A throwaway project holding a copy of the script, and optionally a .env. */
function makeProject({ dotenv } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cheeko-build-env-"));
  roots.push(root);
  mkdirSync(join(root, "tools"));
  mkdirSync(join(root, "assets", "js", "core"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "tools", "build-env.mjs"));
  if (dotenv !== undefined) writeFileSync(join(root, ".env"), dotenv);
  return root;
}

function run(root, env = {}) {
  const result = spawnSync(process.execPath, [join(root, "tools", "build-env.mjs")], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  const outFile = join(root, "assets", "js", "core", "env.js");
  const written = existsSync(outFile);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    outFile,
    written,
    text: written ? readFileSync(outFile, "utf8") : "",
  };
}

/** Import a generated env.js as the page would, and hand back ENV. */
let imports = 0;
async function loadEnv(file) {
  imports += 1;
  return (await import(`${pathToFileURL(file).href}?case=${imports}`)).ENV;
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

/* ---------- no .env: read process.env ---------- */
console.log("\nno .env file — process.env");
{
  const root = makeProject();
  const r = run(root, {
    ...FULL_ENV,
    // Padding a dashboard might add, and two things that must never ship.
    CHEEKO_PUBLIC_API_BASE_URL_PRODUCTION: "  https://ota.cheekoai.in  ",
    DATABASE_URL: "postgres://secret-db-url",
    FIREBASE_SERVICE_ACCOUNT_JSON: "secret-service-account",
  });
  check("exits 0", r.status === 0, `status=${r.status} ${r.stderr.trim()}`);
  check("writes env.js", r.written);

  const env = r.written ? await loadEnv(r.outFile) : {};
  check("generated env.js loads as a module", Boolean(env) && typeof env === "object");
  check("API_ENV comes from process.env", env.API_ENV === "production", String(env.API_ENV));
  check("the production URL is published, trimmed",
    env.API_BASE_URL_PRODUCTION === "https://ota.cheekoai.in", JSON.stringify(env.API_BASE_URL_PRODUCTION));
  check("the other hosts are published",
    env.API_BASE_URL_DEVELOPMENT === "https://otadev.cheekoai.in"
    && env.API_BASE_URL_LOCAL === "http://localhost:8002");
  check("Firebase settings are published", env.FIREBASE_API_KEY === "firebase-key");
  check("the prefix is stripped from key names", !Object.keys(env).some((k) => k.startsWith("CHEEKO_PUBLIC_")),
    Object.keys(env).join(","));
  check("an unprefixed variable is never published",
    !("DATABASE_URL" in env) && !r.text.includes("secret-db-url"));
  check("…nor its value, under any name",
    !r.text.includes("secret-service-account") && !r.text.includes("PATH"));
  check("says which source it read", r.stdout.includes("process environment"), r.stdout.trim());
  check("the header says the values came from the environment, not .env",
    r.text.includes("build's environment variables"));
}
{
  const root = makeProject();
  const r = run(root, { ...FULL_ENV, CHEEKO_PUBLIC_API_ENV: "Production" });
  check("API_ENV is matched case-insensitively, as the page does", r.status === 0, `status=${r.status}`);
}

/* ---------- no .env: refuse to write a page with no backend ---------- */
console.log("\nno .env file — a deploy must name a backend");
{
  const root = makeProject();
  const { CHEEKO_PUBLIC_API_ENV, ...rest } = FULL_ENV;
  const r = run(root, rest);
  check("API_ENV unset: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("API_ENV unset: env.js is NOT written", !r.written);
  check("API_ENV unset: names the missing variable", r.stderr.includes("CHEEKO_PUBLIC_API_ENV"), r.stderr.trim());
}
{
  const root = makeProject();
  const r = run(root, { ...FULL_ENV, CHEEKO_PUBLIC_API_ENV: "   " });
  check("API_ENV blank: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("API_ENV blank: env.js is NOT written", !r.written);
}
{
  const root = makeProject();
  const r = run(root, { ...FULL_ENV, CHEEKO_PUBLIC_API_ENV: "development", CHEEKO_PUBLIC_API_BASE_URL_DEVELOPMENT: "" });
  check("selected URL empty: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("selected URL empty: env.js is NOT written", !r.written);
  check("selected URL empty: names the empty key",
    r.stderr.includes("CHEEKO_PUBLIC_API_BASE_URL_DEVELOPMENT"), r.stderr.trim());
}
{
  const root = makeProject();
  const { CHEEKO_PUBLIC_API_BASE_URL_PRODUCTION, ...rest } = FULL_ENV;
  const r = run(root, rest);
  check("selected URL unset: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("selected URL unset: env.js is NOT written", !r.written);
}
{
  const root = makeProject();
  const r = run(root, { ...FULL_ENV, CHEEKO_PUBLIC_API_ENV: "staging" });
  check("unknown API_ENV: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("unknown API_ENV: env.js is NOT written", !r.written);
  check("unknown API_ENV: lists the valid values",
    r.stderr.includes("production, development, local"), r.stderr.trim());
}
{
  const root = makeProject();
  const r = run(root, {});
  check("nothing at all: exits non-zero", r.status !== 0, `status=${r.status}`);
  check("nothing at all: still points local work at the template", r.stderr.includes(".env.example"), r.stderr.trim());
}

/* ---------- .env present: unchanged ---------- */
console.log("\n.env file present — behaviour unchanged");
{
  const root = makeProject({
    dotenv: [
      "CHEEKO_PUBLIC_API_ENV=local",
      "CHEEKO_PUBLIC_API_BASE_URL_LOCAL=http://localhost:8002",
      "DATABASE_URL=postgres://secret-db-url",
    ].join("\n"),
  });
  // A process env that disagrees — the file must win, as it always has.
  const r = run(root, { CHEEKO_PUBLIC_API_ENV: "production", CHEEKO_PUBLIC_API_BASE_URL_PRODUCTION: "https://ota.cheekoai.in" });
  const env = r.written ? await loadEnv(r.outFile) : {};
  check(".env wins over process.env", env.API_ENV === "local", String(env.API_ENV));
  check("process.env keys are not mixed in", !("API_BASE_URL_PRODUCTION" in env), Object.keys(env).join(","));
  check("an unprefixed .env key is still skipped and reported",
    !r.text.includes("secret-db-url") && r.stdout.includes("Kept out of the browser") && r.stdout.includes("DATABASE_URL"),
    r.stdout.trim());
  check("the header still says .env", r.text.includes("in `.env`. Edit `.env` and re-run that instead"));
  check("does not claim to have read the process environment", !r.stdout.includes("process environment"));
}
{
  // Empty API_ENV in a .env is how local work selects the stand-in. It
  // must keep working: the deploy-time check does not apply here.
  const root = makeProject({ dotenv: "CHEEKO_PUBLIC_API_ENV=\n" });
  const r = run(root, {});
  const env = r.written ? await loadEnv(r.outFile) : {};
  check(".env with empty API_ENV: still exits 0", r.status === 0, `status=${r.status} ${r.stderr.trim()}`);
  check(".env with empty API_ENV: still written, still empty", r.written && env.API_ENV === "", JSON.stringify(env.API_ENV));
}

roots.forEach((root) => rmSync(root, { recursive: true, force: true }));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`));
  process.exit(1);
}
