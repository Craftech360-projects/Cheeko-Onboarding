/**
 * tools/build-env.mjs
 * Reads `.env` and writes `assets/js/core/env.js`, the one module the
 * page imports its deployment settings from.
 *
 *   node tools/build-env.mjs
 *
 * Run it after editing `.env`, and as part of deploying. Both files are
 * gitignored; `.env.example` is the committed template.
 *
 * TWO SOURCES
 * With a `.env` file it reads that file and nothing else, exactly as
 * before. Without one — which is how a deploy host such as Vercel
 * works: no file, only the environment variables set in its project
 * settings — it reads the same CHEEKO_PUBLIC_* keys from `process.env`.
 * In that mode it also refuses to write an env.js that selects no
 * backend (see `requireDeployableBackend`): a deployed page with no
 * backend registers parents into browser storage, and nothing reaches
 * the server.
 *
 * WHY A PREFIX
 * A browser has no secrets: everything written into env.js is served
 * with the page and readable by anyone who opens it. So this script is
 * an allowlist, not a copier — it emits only keys named
 * `CHEEKO_PUBLIC_*` and reports every other key as skipped. That way
 * `.env` can hold backend secrets alongside browser settings without a
 * rename or a typo ever publishing one.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");
const OUT_FILE = join(ROOT, "assets", "js", "core", "env.js");

/** Only a key with this prefix may reach the browser. */
const PUBLIC_PREFIX = "CHEEKO_PUBLIC_";

/**
 * Parse the dotenv subset we actually use: `KEY=value`, `#` comments,
 * blank lines, and optional matching quotes around the value.
 * Deliberately no `export `, no multi-line values, no interpolation —
 * anything fancier belongs in the backend's own config, not here.
 */
function parseEnv(text) {
  const values = {};

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const split = line.indexOf("=");
    if (split === -1) {
      console.warn(`  .env:${index + 1} ignored, no "=" — ${line}`);
      return;
    }

    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();

    // Strip one matching pair of quotes, so a value with a trailing
    // space can be written "…  " when it needs to be.
    const quoted = value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    values[key] = value;
  });

  return values;
}

/** The `.env` file's text, or `null` when there is no `.env` file. */
function readEnvFile() {
  try {
    return readFileSync(ENV_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The CHEEKO_PUBLIC_* keys from the process environment, which is how a
 * deploy host hands over its project settings.
 *
 * Only prefixed keys are collected, so nothing else in `process.env` —
 * PATH, the host's own variables, a real secret — is even read into the
 * list; the allowlist check below still applies on top. Values are
 * trimmed like `.env` lines are, so a stray space pasted into a
 * dashboard does not end up inside a URL.
 */
function readProcessEnv() {
  const values = {};
  Object.entries(process.env).forEach(([key, value]) => {
    if (key.startsWith(PUBLIC_PREFIX)) values[key] = (value ?? "").trim();
  });
  return values;
}

/** The environments `assets/js/core/api-environment.js` knows. */
const API_ENVIRONMENTS = ["production", "development", "local"];

/**
 * Stop a deploy that names no usable backend, before env.js is written.
 *
 * Only called when there is no `.env`. With a file, an empty API_ENV is
 * a legitimate choice — it is how local work selects the stand-in — and
 * that behaviour is unchanged. Without one this is a build, and a build
 * with no backend is the silent data-loss path, so it fails loudly and
 * the host keeps serving the last good deployment.
 */
function requireDeployableBackend(values) {
  const apiEnv = (values.API_ENV || "").trim().toLowerCase();

  if (!apiEnv) {
    fail(
      "There is no .env file, and CHEEKO_PUBLIC_API_ENV is not set in the environment.",
      `Set it to one of ${API_ENVIRONMENTS.join(", ")} — on Vercel under`,
      "Project Settings → Environment Variables — and rebuild.",
      "For local work, create a .env instead: cp .env.example .env",
    );
  }

  if (!API_ENVIRONMENTS.includes(apiEnv)) {
    fail(
      `CHEEKO_PUBLIC_API_ENV is "${values.API_ENV}", which is not one of`,
      `${API_ENVIRONMENTS.join(", ")}.`,
    );
  }

  const urlKey = `API_BASE_URL_${apiEnv.toUpperCase()}`;
  if (!(values[urlKey] || "").trim()) {
    fail(
      `CHEEKO_PUBLIC_API_ENV is "${apiEnv}", but ${PUBLIC_PREFIX}${urlKey}`,
      "is empty or not set, so the page would have no server to register",
      "parents with.",
    );
  }
}

function fail(...lines) {
  console.error(`build-env: ${lines.join("\n  ")}`);
  console.error("\nassets/js/core/env.js was NOT written.");
  process.exit(1);
}

const envText = readEnvFile();
const fromFile = envText !== null;
const parsed = fromFile ? parseEnv(envText) : readProcessEnv();

const published = {};
const skipped = [];

Object.entries(parsed).forEach(([key, value]) => {
  if (key.startsWith(PUBLIC_PREFIX)) {
    published[key.slice(PUBLIC_PREFIX.length)] = value;
  } else {
    skipped.push(key);
  }
});

// Without a .env this is a deploy, and it must name a backend.
if (!fromFile) requireDeployableBackend(published);

// JSON.stringify is the escaping: whatever is in .env — a quote, a
// backslash, a newline — comes out as a valid JS string literal and
// cannot break out of it into code.
const body = Object.entries(published)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
  .join("\n");

// Where the values came from, for the generated file's header. The
// `.env` wording is byte-for-byte what this script always wrote.
const PROVENANCE = fromFile
  ? [
    " * Written by `node tools/build-env.mjs` from the CHEEKO_PUBLIC_* keys",
    " * in `.env`. Edit `.env` and re-run that instead; any change here is",
    " * overwritten. Both files are gitignored.",
  ].join("\n")
  : [
    " * Written by `node tools/build-env.mjs` from the CHEEKO_PUBLIC_* keys",
    " * in the build's environment variables — there was no `.env` file.",
    " * Change them where they are set and rebuild; any change here is",
    " * overwritten.",
  ].join("\n");

const generated = `/**
 * core/env.js — GENERATED FILE, DO NOT EDIT.
 *
${PROVENANCE}
 *
 * Everything below is served to the browser and visible in page
 * source. Only values that are safe to expose belong here.
 */

export const ENV = {
${body}
};
`;

writeFileSync(OUT_FILE, generated, "utf8");

const count = Object.keys(published).length;
console.log(`Wrote assets/js/core/env.js — ${count} public value${count === 1 ? "" : "s"}.`);
if (!fromFile) {
  console.log(`  Read from the process environment (no .env file). API environment: ${published.API_ENV}.`);
}

const empty = Object.entries(published).filter(([, value]) => !value).map(([key]) => key);
if (empty.length) {
  console.log(`\n  Empty (the page falls back for each): ${empty.join(", ")}`);
}

if (skipped.length) {
  console.log(`\n  Kept out of the browser, no ${PUBLIC_PREFIX} prefix: ${skipped.join(", ")}`);
}
