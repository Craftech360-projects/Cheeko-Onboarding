/**
 * The Device Info section: every toy on the signed-in parent's account,
 * from GET /toy/api/mobile/devices, named for its child from GET /kids,
 * with its warranty from GET /devices/warranty.
 *
 * The real page with only core/firebase.js stubbed (Google's popup cannot
 * be automated) and the API intercepted, so features/device-info.js and
 * core/parent-directory.js run as shipped.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";
const USER = { uid: "u-devices", email: "parent@example.com", displayName: "Parent" };
const PROFILE = { parent_name: "Parent", email: USER.email, phone_number: "+919812345678", preferred_language: "en" };

// Signed in from the first frame when window.__SIGNED_IN_AS is set, as a
// session Firebase restored on load would be.
const STUB = `
let user = window.__SIGNED_IN_AS || null;
const L = new Set();
const notify = () => L.forEach((l) => l(user));
export async function signInWith() { user = window.__SIGNED_IN_AS || ${JSON.stringify(USER)}; notify(); return user; }
export async function signOutOfFirebase() { user = null; notify(); }
export async function getIdToken() { return user ? "test-id-token" : null; }
export async function watchAuthState(l) { L.add(l); setTimeout(() => l(user), 0); return () => L.delete(l); }
`;

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const ok = (data) => json(200, { code: 0, msg: "success", data });
const notFound = (path) => ({ status: 404, contentType: "text/html", body: `<pre>Cannot GET /toy/api/mobile${path}</pre>` });

/** A row as the backend's formatMobileDevice sends it (its camelCase half). */
const device = (macAddress, extra = {}) => ({
  macAddress, deviceName: "Cheeko - 1", alias: null, kidId: null, board: "cheeko-v2",
  mode: "conversation", deviceMode: "manual", appVersion: "2.4.251", autoUpdate: 1,
  lastConnectedAt: "2026-09-11T06:40:16.000Z", createdAt: "2026-09-08T07:19:07.000Z",
  ...extra,
});

const ROHAN = device("AA:BB:CC:DD:EE:01", { deviceName: "Rohan's Cheeko", kidId: 41 });
const OLD = device("AA:BB:CC:DD:EE:02", { deviceName: "Old Fox", autoUpdate: 0 });
const SPARE = device("AA:BB:CC:DD:EE:03", { deviceName: "Cheeko 3", appVersion: null, board: null, autoUpdate: undefined });

const DEVICES = ok({ list: [ROHAN, OLD, SPARE], total: 3, page: 1, limit: 100 });
// /kids answers a bare array, not the { code, data } envelope.
const KIDS = json(200, [{ id: "41", name: "Rohan", nickname: "Ro", device_mac: ROHAN.macAddress }]);
const WARRANTIES = ok([
  { macAddress: ROHAN.macAddress, deviceName: ROHAN.deviceName,
    warranty: { registered: true, warrantyMonths: 6, status: "active", daysRemaining: 10,
      warrantyStart: "2026-03-20T12:00:00.000Z", warrantyEnd: "2026-09-20T12:00:00.000Z" } },
  // Cased differently from the device list on purpose: still the same toy.
  { macAddress: "aa:bb:cc:dd:ee:02", deviceName: OLD.deviceName,
    warranty: { registered: true, warrantyMonths: 6, status: "expired", daysRemaining: 0,
      warrantyStart: "2025-01-10T12:00:00.000Z", warrantyEnd: "2025-07-10T12:00:00.000Z" } },
  { macAddress: SPARE.macAddress, deviceName: SPARE.deviceName,
    warranty: { registered: false, status: "not_registered", warrantyMonths: 6 } },
]);

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

/**
 * `api` maps "/devices", "/devices/warranty" and "/kids" to an answer, or
 * to a function of how many times that path has been asked.
 */
async function openPage(browser, { signedIn = true, api = {}, query = "?api=production", viewport } = {}) {
  const answers = { "/devices": ok({ list: [] }), "/devices/warranty": ok([]), "/kids": json(200, []), ...api };
  const context = await browser.newContext({ timezoneId: "Asia/Kolkata", ...(viewport && { viewport }) });
  const page = await context.newPage();
  const requests = [];
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.route("**/__stub/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: STUB }));
  await page.route((url) => url.origin === ORIGIN && (url.pathname === "/" || url.pathname === "/index.html"), async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace('<script type="module" src="assets/js/main.js"></script>',
      '<script type="importmap">{"imports":{"/assets/js/core/firebase.js":"/__stub/firebase.js"}}</script>\n<script type="module" src="assets/js/main.js"></script>');
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), "content-length": undefined } });
  });
  await page.route((url) => url.pathname.startsWith("/toy/api/mobile/"), async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/toy/api/mobile", "");
    if (path in answers) {
      requests.push({ path, auth: route.request().headers().authorization });
      const answer = answers[path];
      const asked = requests.filter((r) => r.path === path).length;
      return route.fulfill(typeof answer === "function" ? await answer(asked) : answer);
    }
    if (path === "/parent-profile") return route.fulfill(ok(PROFILE));
    return route.fulfill(ok({}));
  });

  await page.addInitScript((u) => { window.__SIGNED_IN_AS = u; }, signedIn ? USER : null);
  await page.goto(`${ORIGIN}/index.html${query}`);
  return { context, page, requests, pageErrors };
}

/** Names of the [data-device-view] elements currently shown. */
const shownViews = async (page) => JSON.stringify(await page.evaluate(() =>
  [...document.querySelectorAll("[data-device-view]")]
    .filter((el) => !el.classList.contains("is-hidden"))
    .map((el) => el.dataset.deviceView)));

/** Wait until the section has settled on one view that isn't transitional. */
const settle = (page) => page.waitForFunction(() => {
  const shown = [...document.querySelectorAll("[data-device-view]")]
    .filter((el) => !el.classList.contains("is-hidden"));
  return shown.length === 1 && !["checking", "loading"].includes(shown[0].dataset.deviceView);
}, null, { timeout: 10000 });

/** Everything a parent can read on each card. */
const readCards = (page) => page.$$eval(".toy-card", (items) => items.map((item) => ({
  name: item.querySelector(".toy-card__name")?.textContent,
  facts: Object.fromEntries([...item.querySelectorAll(".toy-card__fact")]
    .map((f) => [f.querySelector("dt").textContent, f.querySelector("dd").textContent])),
  warrantyClass: item.querySelector(".device-warranty")?.className,
  status: item.querySelector(".device-warranty__status")?.textContent ?? null,
  days: item.querySelector(".device-warranty__days")?.textContent ?? null,
  dates: [...item.querySelectorAll(".device-warranty__dates span")].map((s) => s.textContent),
  fill: item.querySelector(".device-warranty__fill")?.style.width ?? null,
  note: item.querySelector(".device-warranty__note")?.textContent ?? null,
  mailto: item.querySelector(".device-warranty__note a")?.getAttribute("href") ?? null,
})));

// en-IN abbreviates September as "Sept" in current ICU, "Sep" in older.
const SEPT = "Sept?";

// Everything a card lists, in order, and nothing else.
const FACTS = ["Child profile", "MAC ID", "Firmware", "Board", "OTA auto-update"];

const browser = await chromium.launch();

console.log("\nthe section");
{
  const { context, page } = await openPage(browser, { signedIn: false });
  await settle(page);
  check("no 'Register Your Warranty' form", (await page.$("#warrantyForm")) === null);
  check("the old warranty-only section is gone", (await page.$("#warrantySection")) === null);
  check("heading is Device Info", (await page.textContent(".device-info__title")) === "Device Info");
  check("still states the 6-month warranty, matching the backend",
    (await page.textContent(".device-info__lede")).includes("6-month"));
  await context.close();
}

console.log("\nsigned out");
{
  const { context, page, requests } = await openPage(browser, { signedIn: false });
  await settle(page);
  check("asks the parent to sign in", (await shownViews(page)) === '["signed-out"]', await shownViews(page));
  check("asks the server nothing", requests.length === 0, `requests=${requests.length}`);
  await page.click("[data-device-signin]");
  check("its Sign in button opens the sign-in card", await page.isVisible("#authModal.modal--open"));
  await context.close();
}

console.log("\nsigned in, three toys");
{
  const { context, page, requests, pageErrors } = await openPage(browser, {
    api: { "/devices": DEVICES, "/devices/warranty": WARRANTIES, "/kids": KIDS },
  });
  await settle(page);
  check("shows the list", (await shownViews(page)) === '["list"]', await shownViews(page));
  const paths = requests.map((r) => r.path).sort();
  check("one request each to the device list, the warranties and the children",
    JSON.stringify(paths) === '["/devices","/devices/warranty","/kids"]', JSON.stringify(paths));
  check("every request carries the parent's token",
    requests.every((r) => r.auth === "Bearer test-id-token"), JSON.stringify(requests));

  const cards = await readCards(page);
  check("one card per toy, in the order the server sent them",
    cards.map((c) => c.name).join(",") === "Rohan's Cheeko,Old Fox,Cheeko 3", cards.map((c) => c.name).join(","));
  const [rohan, old, spare] = cards;

  console.log("  -- details");
  check("only child profile, MAC ID, firmware, board and OTA auto-update, in that order",
    cards.every((c) => JSON.stringify(Object.keys(c.facts)) === JSON.stringify(FACTS)),
    JSON.stringify(cards.map((c) => Object.keys(c.facts))));
  check("child profile named from /kids", rohan?.facts["Child profile"] === "Rohan", rohan?.facts["Child profile"]);
  check("MAC ID shown for support", rohan?.facts["MAC ID"] === "AA:BB:CC:DD:EE:01", rohan?.facts["MAC ID"]);
  check("firmware", rohan?.facts.Firmware === "2.4.251", rohan?.facts.Firmware);
  check("board", rohan?.facts.Board === "cheeko-v2", rohan?.facts.Board);
  check("OTA auto-update: on and off", rohan?.facts["OTA auto-update"] === "On" && old?.facts["OTA auto-update"] === "Off",
    `${rohan?.facts["OTA auto-update"]} / ${old?.facts["OTA auto-update"]}`);
  check("OTA auto-update unknown is a dash, not 'Off'", spare?.facts["OTA auto-update"] === "—", spare?.facts["OTA auto-update"]);
  check("a toy with no child set up says so with a dash", old?.facts["Child profile"] === "—", old?.facts["Child profile"]);
  check("missing firmware and board are dashes, not 'null'",
    spare?.facts.Firmware === "—" && spare?.facts.Board === "—", JSON.stringify(spare?.facts));

  console.log("  -- warranty");
  check("active: status", rohan?.status === "Active" && rohan.warrantyClass.includes("--active"), rohan?.status);
  check("active: days remaining", rohan?.days === "10 days remaining", rohan?.days);
  check("active: start and end dates",
    rohan?.dates[0] === "Started 20 Mar 2026" && new RegExp(`^Ends 20 ${SEPT} 2026$`).test(rohan?.dates[1]),
    JSON.stringify(rohan?.dates));
  check("active: the bar shows how much cover is used", /^\d{1,3}%$/.test(rohan?.fill || ""), String(rohan?.fill));
  check("expired: matched to its toy despite the MAC's case",
    old?.status === "Expired" && old.warrantyClass.includes("--expired"), old?.status);
  check("expired: says so, and when it ended",
    old?.days === "Out of warranty" && old?.dates[1] === "Ended 10 Jul 2025", `${old?.days} | ${old?.dates[1]}`);
  check("not on record: status", spare?.status === "Not on record" && spare.warrantyClass.includes("--missing"), spare?.status);
  check("not on record: no invented dates", spare?.dates.length === 0 && spare?.days === null, JSON.stringify(spare?.dates));
  check("not on record: tells the parent how to fix it", spare?.mailto === "mailto:hello@altio.me", String(spare?.mailto));
  check("no script errors", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();
}

console.log("\nphone to desktop");
for (const width of [320, 390, 1280]) {
  const { context, page } = await openPage(browser, {
    viewport: { width, height: 800 },
    api: { "/devices": DEVICES, "/devices/warranty": WARRANTIES, "/kids": KIDS },
  });
  await settle(page);
  const layout = await page.evaluate(() => {
    const overflowing = [...document.querySelectorAll(".toy-card, .toy-card__fact, .toy-card__fact dd, .device-warranty")]
      .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.className || node.tagName);
    const card = document.querySelector(".toy-card");
    const [details, warranty] = card.querySelectorAll(".toy-card__section");
    return {
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
      overflowing,
      stacked: details.getBoundingClientRect().bottom <= warranty.getBoundingClientRect().top,
      // From the warranty to the card's edge: its padding, nothing more.
      tail: Math.round(card.getBoundingClientRect().bottom - warranty.getBoundingClientRect().bottom),
    };
  });
  check(`${width}px: nothing scrolls sideways`, !layout.pageScrolls && layout.overflowing.length === 0,
    JSON.stringify(layout.overflowing));
  check(`${width}px: details stack above the warranty`, layout.stacked);
  check(`${width}px: the card ends right after the warranty`, layout.tail <= 40, `${layout.tail}px`);
  await context.close();
}

console.log("\nwarranty endpoint not deployed yet (production today)");
{
  const { context, page } = await openPage(browser, {
    api: { "/devices": DEVICES, "/devices/warranty": notFound("/devices/warranty"), "/kids": KIDS },
  });
  await settle(page);
  check("the toys are still listed", (await shownViews(page)) === '["list"]', await shownViews(page));
  const cards = await readCards(page);
  check("with all their details", cards.length === 3 && cards[0].facts.Firmware === "2.4.251", JSON.stringify(cards[0]?.facts));
  check("and each warranty block says it isn't available yet",
    cards.every((c) => c.note?.includes("aren't available just yet") && c.status === null), JSON.stringify(cards.map((c) => c.note)));
  await context.close();
}

console.log("\nchildren unreadable");
{
  const { context, page } = await openPage(browser, {
    api: { "/devices": DEVICES, "/devices/warranty": WARRANTIES, "/kids": json(500, { msg: "boom" }) },
  });
  await settle(page);
  const cards = await readCards(page);
  check("the toys and warranties still show", (await shownViews(page)) === '["list"]' && cards[0]?.status === "Active",
    await shownViews(page));
  check("child profile falls back to a dash", cards[0]?.facts["Child profile"] === "—", cards[0]?.facts["Child profile"]);
  await context.close();
}

console.log("\nnames are text, never markup");
{
  const hostile = '<img src=x onerror="window.__pwned=1">';
  const { context, page } = await openPage(browser, {
    api: {
      "/devices": ok({ list: [{ ...ROHAN, deviceName: hostile }] }),
      "/kids": json(200, [{ id: "41", name: hostile }]),
    },
  });
  await settle(page);
  await page.waitForTimeout(300);
  const [card] = await readCards(page);
  check("device name rendered literally", card?.name === hostile, card?.name);
  check("child name rendered literally", card?.facts["Child profile"] === hostile, card?.facts["Child profile"]);
  check("no element was created from them", (await page.$$("#deviceList img")).length === 0);
  check("nothing ran", (await page.evaluate(() => window.__pwned)) === undefined);
  await context.close();
}

console.log("\nno toys, no endpoint, server down");
{
  const { context, page } = await openPage(browser, { api: { "/devices": ok({ list: [], total: 0 }) } });
  await settle(page);
  check("an account with no toys says so", (await shownViews(page)) === '["empty"]', await shownViews(page));
  await context.close();
}
{
  const { context, page } = await openPage(browser, { api: { "/devices": notFound("/devices") } });
  await settle(page);
  check("a host without the device list: 'not available', not an outage",
    (await shownViews(page)) === '["unavailable"]'
    && (await page.textContent("#deviceUnavailableText")).includes("aren't available"),
    await page.textContent("#deviceUnavailableText"));
  await context.close();
}
{
  const { context, page, requests } = await openPage(browser, {
    api: { "/devices": (n) => (n === 1 ? json(500, { msg: "boom" }) : DEVICES) },
  });
  await settle(page);
  check("a failed device list offers a retry", (await shownViews(page)) === '["error"]', await shownViews(page));
  await page.click("[data-device-retry]");
  await settle(page);
  const asked = requests.filter((r) => r.path === "/devices").length;
  check("and the retry loads the list", (await shownViews(page)) === '["list"]' && asked === 2,
    `${await shownViews(page)} requests=${asked}`);
  await context.close();
}

console.log("\nstand-in mode");
{
  const { context, page, requests } = await openPage(browser, { query: "?api=standin" });
  await settle(page);
  check("says there is no server to ask",
    (await shownViews(page)) === '["unavailable"]'
    && (await page.textContent("#deviceUnavailableText")).includes("stand-in"),
    await page.textContent("#deviceUnavailableText"));
  check("and does not invent a request", requests.length === 0, `requests=${requests.length}`);
  await context.close();
}

console.log("\nsigning out");
{
  const { context, page } = await openPage(browser, { api: { "/devices": DEVICES } });
  await settle(page);
  await page.evaluate(async () => (await import("/__stub/firebase.js")).signOutOfFirebase());
  await settle(page);
  check("back to the sign-in prompt", (await shownViews(page)) === '["signed-out"]', await shownViews(page));
  check("the previous parent's toys are cleared", (await page.$$("#deviceList li")).length === 0);
  await context.close();
}
{
  // Signed out while the list was still loading: the late answer must not
  // put the previous parent's toys back on screen.
  const { context, page } = await openPage(browser, {
    api: { "/devices": async () => { await new Promise((r) => setTimeout(r, 1500)); return DEVICES; } },
  });
  await page.waitForFunction(() => !document.querySelector('[data-device-view="loading"]').classList.contains("is-hidden"));
  await page.evaluate(async () => (await import("/__stub/firebase.js")).signOutOfFirebase());
  await page.waitForTimeout(2200);
  check("a late answer after sign-out is dropped",
    (await shownViews(page)) === '["signed-out"]' && (await page.$$("#deviceList li")).length === 0,
    await shownViews(page));
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
