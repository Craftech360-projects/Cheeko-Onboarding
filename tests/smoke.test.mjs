/**
 * The page as it really ships — no stubs, real Firebase SDK from the
 * CDN, real config. Checks that nothing regressed outside the auth card
 * and that the settings module actually resolved.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });

await page.goto("http://localhost:3000/index.html", { waitUntil: "networkidle" });

const ok = (n, v, d = "") => console.log(`${v ? "  PASS" : "  FAIL"}  ${n}${d ? `  ${d}` : ""}`);

// Settings resolved through the generated env.js?
const cfg = await page.evaluate(async () => {
  const [c, e] = await Promise.all([
    import("/assets/js/core/config.js"),
    import("/assets/js/core/api-environment.js"),
  ]);
  return {
    urls: c.API_BASE_URLS, envName: c.API_ENV,
    key: c.WEB3FORMS_ACCESS_KEY, project: c.FIREBASE_CONFIG.projectId,
    resolved: e.API_ENVIRONMENT, base: e.PARENT_API_BASE_URL, source: e.API_ENVIRONMENT_SOURCE,
  };
});
ok("all three API hosts loaded from .env",
  cfg.urls.production === "https://ota.cheekoai.in"
  && cfg.urls.development === "https://otadev.cheekoai.in"
  && Boolean(cfg.urls.local), JSON.stringify(cfg.urls));

// What the *committed template* ships is the thing worth pinning: dev,
// not production, because production's CORS allowlist does not include
// this site yet and a default pointing there hands anyone who runs the
// repo an opaque "Failed to fetch".
//
// Read from .env.example, not the local .env — a developer pointing
// their own copy at another backend is normal and must not fail this.
const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const templateEnv = template.match(/^CHEEKO_PUBLIC_API_ENV=(.*)$/m)?.[1]?.trim();
ok("the committed template defaults to development, not production",
  templateEnv === "development", String(templateEnv));

// The local .env is then only checked for self-consistency: whatever it
// selects is what the page must actually resolve to.
const expectedBase = cfg.urls[cfg.envName] ?? "";
ok("the page resolved the environment .env selected",
  cfg.resolved === (cfg.envName || "standin"), `${cfg.envName || "(unset)"} -> ${cfg.resolved}`);
ok("and resolved it to that environment's host",
  cfg.base === expectedBase, `${cfg.base || "(stand-in)"}`);
ok("and reports where that came from",
  cfg.source === ".env" || cfg.source === "default", cfg.source);
if (cfg.envName !== "development") {
  console.log(`  NOTE  local .env selects "${cfg.envName}", not the template's "development".`);
}
ok("Web3Forms key loaded", cfg.key.length > 10);
ok("Firebase project loaded", cfg.project === "cheekoai", cfg.project);

// parent-directory must agree with the resolver, either way.
const live = await page.evaluate(async () => (await import("/assets/js/core/parent-directory.js")).isBackendLive);
ok("parent-directory agrees with the resolver",
  live === (cfg.resolved !== "standin"), `isBackendLive=${live}, resolved=${cfg.resolved}`);

// Page furniture still works.
ok("header button rendered", (await page.textContent("#headerAccountBtn")) === "Sign in");
const account = await page.evaluate(() => {
  const button = document.getElementById("headerAccountBtn");
  const box = button.getBoundingClientRect();
  return {
    icon: Boolean(button.querySelector("svg.account-button__icon")),
    width: Math.round(box.width), height: Math.round(box.height),
    labelOnScreen: document.getElementById("headerAccountLabel").getBoundingClientRect().width > 1,
    title: button.title,
  };
});
ok("header button is a round user icon", account.icon && account.width === account.height, JSON.stringify(account));
ok("with no visible text, but a label and tooltip that say Sign in",
  !account.labelOnScreen && account.title === "Sign in", JSON.stringify(account));
ok("wizard rendered 5 panels", (await page.locator(".wizard__panel").count()) === 5);

// Step 1: the two store logos, bare and side by side, each opening its store.
const stores = await page.$$eval(".store-badges__link", (links) => links.map((a) => {
  const img = a.querySelector("img");
  const box = a.getBoundingClientRect();
  return {
    href: a.href, target: a.target, rel: a.rel, label: a.getAttribute("aria-label") || "",
    loaded: Boolean(img?.complete && img.naturalWidth > 0),
    top: Math.round(box.top), left: Math.round(box.left),
    background: getComputedStyle(a).backgroundColor,
  };
}));
ok("step 1 shows both store logos", stores.length === 2 && stores.every((s) => s.loaded),
  JSON.stringify(stores.map((s) => s.loaded)));
ok("the App Store logo opens the App Store listing",
  stores[0]?.href === "https://apps.apple.com/in/app/cheekoai/id6748904798", stores[0]?.href);
ok("the Google Play logo opens the Play listing",
  stores[1]?.href === "https://play.google.com/store/apps/details?id=com.cheekoai.in", stores[1]?.href);
ok("both open in a new tab, without handing it this page",
  stores.every((s) => s.target === "_blank" && s.rel.includes("noopener")));
ok("each still names its store for screen readers",
  /App Store/.test(stores[0]?.label) && /Google Play/.test(stores[1]?.label));
ok("side by side, with no box behind them",
  stores[0]?.top === stores[1]?.top && stores[1]?.left > stores[0]?.left
  && stores.every((s) => s.background === "rgba(0, 0, 0, 0)"), JSON.stringify(stores.map((s) => [s.top, s.left, s.background])));

await page.click("#headerAccountBtn");
await page.waitForSelector("#authModal.modal--open");
ok("auth card opens", await page.isVisible("#authChoose"));
ok("register form starts hidden", !(await page.isVisible("#authRegisterForm")));
ok("Google button present and enabled", await page.isEnabled("#authGoogleBtn"));
await page.keyboard.press("Escape");

// Support tabs + FAQ accordion.
const tabs = await page.locator("[data-tab]").count();
ok("support tabs wired", tabs > 0, `${tabs} tab triggers`);
const faq = page.locator(".accordion__trigger, [class*=accordion] button").first();
if (await faq.count()) { await faq.click(); ok("FAQ accordion clickable", true); }

// Real Firebase SDK actually loaded from the CDN?
const sdk = await page.evaluate(() => performance.getEntriesByType("resource")
  .filter(r => r.name.includes("firebasejs")).map(r => r.name.split("/").pop()));
ok("Firebase SDK fetched from the CDN", sdk.length >= 2, sdk.join(", "));

console.log(`\nconsole/network errors: ${errors.length}`);
errors.forEach(e => console.log(`  ${e}`));
await browser.close();
