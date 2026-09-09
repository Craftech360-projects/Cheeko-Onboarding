/**
 * Which of the configured API hosts a browser can actually reach, from
 * which origin.
 *
 * Only a browser can answer this. curl ignores CORS entirely, so a host
 * whose allowlist omits the origin looks perfectly healthy from the
 * shell and refuses every request from the page. A fake bearer token is
 * used on purpose: a 401 arriving at the page is the pass, because it
 * proves the preflight passed and the response was readable.
 *
 *   npm run test:cors
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const PATH = "/toy/api/mobile/parent-profile";

/** The hosts from the generated env.js, so this tracks .env. */
function hosts() {
  const source = readFileSync(new URL("../assets/js/core/env.js", import.meta.url), "utf8");
  const read = (key) => source.match(new RegExp(key + ':\\s*"([^"]*)"'))?.[1] || "";
  return [
    ["production", read("API_BASE_URL_PRODUCTION")],
    ["development", read("API_BASE_URL_DEVELOPMENT")],
    ["local", read("API_BASE_URL_LOCAL")],
  ].filter(([, url]) => url);
}

// The two ports this page is served on locally, plus the live domain.
const ORIGINS = ["http://localhost:3000", "http://localhost:8080", "https://www.cheekoai.in"];

const browser = await chromium.launch();
const table = [];

for (const origin of ORIGINS) {
  const page = await browser.newPage();
  // Any same-origin document will do as a base for the fetch.
  await page.route(`${origin}/**`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>probe</title>" }));
  await page.goto(`${origin}/probe`);

  for (const [name, base] of hosts()) {
    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: "Bearer not-a-real-token", "Content-Type": "application/json" },
        });
        return { reached: true, status: response.status };
      } catch (error) {
        return { reached: false, error: `${error.name}: ${error.message}` };
      }
    }, `${base}${PATH}`);

    table.push({ origin, name, base, ...result });
  }
  await page.close();
}

await browser.close();

console.log("\nCan a browser reach the API?  (a 401 is a PASS — the request got through)\n");
let lastOrigin = null;
for (const row of table) {
  if (row.origin !== lastOrigin) { console.log(`  from ${row.origin}`); lastOrigin = row.origin; }
  const verdict = row.reached ? `REACHED  http ${row.status}` : `BLOCKED  ${row.error}`;
  console.log(`    ${row.name.padEnd(12)} ${row.base.padEnd(28)} ${verdict}`);
}

const reachable = table.filter((r) => r.reached);
console.log(`\n${reachable.length}/${table.length} host+origin pairs are usable from a browser.`);
if (reachable.length) {
  console.log("Usable now: " + reachable.map((r) => `${r.name} from ${r.origin}`).join("; "));
}
const blocked = table.filter((r) => !r.reached);
const remote = blocked.filter((r) => !r.base.includes("localhost"));
const localHosts = blocked.filter((r) => r.base.includes("localhost"));

if (remote.length) {
  console.log(
    "\nEach BLOCKED row above needs its origin added to that host's CORS"
    + "\nallowlist, server-side. Nothing in this repo can change it.",
  );
}
if (localHosts.length) {
  console.log(
    "\nBlocked rows for a localhost API usually just mean nothing is"
    + "\nlistening on that port yet — start the backend and re-run.",
  );
}
