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

function readEnvFile() {
  try {
    return readFileSync(ENV_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error("No .env found. Start from the template:\n");
      console.error("  cp .env.example .env\n");
      process.exit(1);
    }
    throw error;
  }
}

const parsed = parseEnv(readEnvFile());

const published = {};
const skipped = [];

Object.entries(parsed).forEach(([key, value]) => {
  if (key.startsWith(PUBLIC_PREFIX)) {
    published[key.slice(PUBLIC_PREFIX.length)] = value;
  } else {
    skipped.push(key);
  }
});

// JSON.stringify is the escaping: whatever is in .env — a quote, a
// backslash, a newline — comes out as a valid JS string literal and
// cannot break out of it into code.
const body = Object.entries(published)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
  .join("\n");

const generated = `/**
 * core/env.js — GENERATED FILE, DO NOT EDIT.
 *
 * Written by \`node tools/build-env.mjs\` from the CHEEKO_PUBLIC_* keys
 * in \`.env\`. Edit \`.env\` and re-run that instead; any change here is
 * overwritten. Both files are gitignored.
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

const empty = Object.entries(published).filter(([, value]) => !value).map(([key]) => key);
if (empty.length) {
  console.log(`\n  Empty (the page falls back for each): ${empty.join(", ")}`);
}

if (skipped.length) {
  console.log(`\n  Kept out of the browser, no ${PUBLIC_PREFIX} prefix: ${skipped.join(", ")}`);
}
