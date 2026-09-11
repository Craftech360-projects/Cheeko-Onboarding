/**
 * Press feedback: every tappable control sinks a little while held and
 * springs back on release — felt, not seen — and on a touch screen a
 * tapped control is never left stuck in its hover lift. Plus the
 * entrances a tap triggers: a support tab's panel and an FAQ answer.
 *
 * Firebase is stubbed (signed out) and the API is the stand-in, so this
 * runs with no network.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";

const STUB = `
export async function signInWith() { return null; }
export async function signOutOfFirebase() {}
export async function getIdToken() { return null; }
export async function watchAuthState(l) { setTimeout(() => l(null), 0); return () => {}; }
`;

/** No press may sink a control further than this: the brief says subtle. */
const DEEPEST_PRESS = 0.88;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function openPage(browser, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/__stub/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: STUB }));
  await page.route((url) => url.origin === ORIGIN && url.pathname === "/index.html", async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace('<script type="module" src="assets/js/main.js"></script>',
      '<script type="importmap">{"imports":{"/assets/js/core/firebase.js":"/__stub/firebase.js"}}</script>\n<script type="module" src="assets/js/main.js"></script>');
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), "content-length": undefined } });
  });
  await page.goto(`${ORIGIN}/index.html?api=standin`, { waitUntil: "networkidle" });
  return { context, page, errors };
}

/** The element's scale (1 when untransformed) and its vertical offset. */
const transformOf = (page, selector) => page.$eval(selector, (el) => {
  const t = getComputedStyle(el).transform;
  const m = t === "none" ? new DOMMatrix() : new DOMMatrix(t);
  return { scale: Math.round(m.a * 1000) / 1000, y: Math.round(m.f * 10) / 10 };
});

/**
 * Read the transform once it has stopped moving. A fixed wait is not
 * enough on a busy machine — the suite once caught a tab mid-transition
 * at 0.976 while other browser jobs were running — so poll until two
 * reads agree, giving up after a second.
 */
async function settledTransform(page, selector) {
  let last = await transformOf(page, selector);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(50);
    const now = await transformOf(page, selector);
    if (now.scale === last.scale && now.y === last.y) return now;
    last = now;
  }
  return last;
}

const token = (page, name) => page.evaluate((n) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name);

/**
 * Press and hold, read, then slide off before letting go — so the press
 * is measured and nothing is actually clicked.
 */
async function pressAndRead(page, selector) {
  const el = await page.$(selector);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const pressed = await settledTransform(page, selector);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const released = await settledTransform(page, selector);
  return { pressed, released };
}

async function expectPress(page, name, selector, tokenName) {
  const want = await token(page, tokenName);
  const { pressed, released } = await pressAndRead(page, selector);
  check(`${name} sinks to ${tokenName} (${want}) while held`,
    Math.abs(pressed.scale - want) < 0.005 && pressed.scale >= DEEPEST_PRESS && pressed.scale < 1,
    `scale=${pressed.scale}`);
  check(`${name} springs back on release`, released.scale === 1 && released.y === 0, JSON.stringify(released));
}

const browser = await chromium.launch();

console.log("\nthe press tokens stay subtle");
{
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 800 } });
  for (const name of ["--press-scale-icon", "--press-scale", "--press-scale-row"]) {
    const value = await token(page, name);
    check(`${name} is between ${DEEPEST_PRESS} and 1`, value >= DEEPEST_PRESS && value < 1, String(value));
  }
  await context.close();
}

console.log("\npressing, on a phone-width screen");
{
  // Phone width, with a mouse to hold presses down: this is where the
  // stepper dots shrink (on desktop they ring instead; see below).
  const { context, page, errors } = await openPage(browser, { viewport: { width: 390, height: 800 } });
  await expectPress(page, "the primary button", '[data-wizard-next="2"]', "--press-scale");
  await expectPress(page, "a stepper dot", '.stepper__dot[data-step="3"]', "--press-scale-icon");
  await expectPress(page, "the App Store logo", ".store-badges__link", "--press-scale-icon");
  await expectPress(page, "the header's user icon", "#headerAccountBtn", "--press-scale-icon");
  await expectPress(page, "a support tab", ".tabs__tab:not(.tabs__tab--active)", "--press-scale");
  await expectPress(page, "a video card", ".video-card", "--press-scale");

  await page.click('.tabs__tab:has-text("FAQ")');
  const panelEntrance = await page.$eval(".tab-panel:not(.is-hidden)", (p) => getComputedStyle(p).animationName);
  check("a support tab's panel eases in", panelEntrance === "rise-in", panelEntrance);

  await expectPress(page, "an FAQ row", ".accordion__item", "--press-scale-row");
  await page.click(".accordion__item");
  const answer = await page.$eval(".accordion__item--open .accordion__answer", (a) => ({
    shown: !a.classList.contains("is-hidden"), entrance: getComputedStyle(a).animationName,
  }));
  check("an FAQ answer eases in as it opens", answer.shown && answer.entrance === "rise-in", JSON.stringify(answer));
  check("no script errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

console.log("\non a desktop");
{
  const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 800 } });
  await page.hover('[data-wizard-next="2"]');
  await page.waitForTimeout(300);
  const lifted = await transformOf(page, '[data-wizard-next="2"]');
  check("buttons still lift on hover", lifted.y === -2, JSON.stringify(lifted));

  // The dot's step name hangs off it here, so the press is a ring, not a shrink.
  const dot = '.stepper__dot[data-step="3"]';
  const box = await (await page.$(dot)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(220);
  const held = await page.$eval(dot, (d) => ({ transform: getComputedStyle(d).transform, shadow: getComputedStyle(d).boxShadow }));
  await page.mouse.move(1, 1);
  await page.mouse.up();
  check("a stepper dot rings instead of shrinking, so its label stays put",
    held.transform === "none" && held.shadow.includes("5px"), JSON.stringify(held));
  await context.close();
}

console.log("\non a touch screen");
{
  const { context, page } = await openPage(browser, {
    viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true,
  });
  const canHover = await page.evaluate(() => matchMedia("(hover: hover)").matches);
  check("the emulated phone reports no hover", canHover === false, `hover: hover -> ${canHover}`);
  await page.tap(".tabs__tab:not(.tabs__tab--active)");
  await page.tap('[data-wizard-next="2"]');
  await page.waitForTimeout(700);
  const after = await transformOf(page, '[data-wizard-next="2"]');
  check("a tapped button is not left stuck in its hover lift", after.y === 0 && after.scale === 1, JSON.stringify(after));
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
