/**
 * Moving through the setup wizard. Each "Next Step" must land the parent
 * on the new step whole: its top just under the sticky header and all of
 * it on screen, its own Next button included — so they read it and tap
 * on without scrolling up to find the start or down to find the button.
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

/** How far below the header the step's top may land and still count as "just under". */
const TOP_SLACK = 24;

/** Phones are tapped, laptops clicked — the way each is really used. */
const SCREENS = [
  ["a phone (390×844)", { width: 390, height: 844 }, true],
  ["an Android phone (360×800)", { width: 360, height: 800 }, true],
  ["a large phone (412×915)", { width: 412, height: 915 }, true],
  ["a laptop (1280×800)", { width: 1280, height: 800 }, false],
  ["a small laptop (1366×768)", { width: 1366, height: 768 }, false],
];

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function openPage(browser, viewport, touch) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
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
  await page.waitForTimeout(300);
  return { context, page, errors };
}

/** Where step `step` (1-based) sits on screen right now. */
const whereIs = (page, step) => page.evaluate((index) => {
  const panel = document.querySelectorAll(".wizard__panel")[index];
  const card = panel.querySelector(".step-card").getBoundingClientRect();
  const next = panel.querySelector("[data-wizard-next], #finishOnboardingBtn").getBoundingClientRect();
  return {
    header: document.querySelector(".site-header").offsetHeight,
    screen: innerHeight,
    top: Math.round(card.top), bottom: Math.round(card.bottom),
    nextBottom: Math.round(next.bottom),
  };
}, step - 1);

const browser = await chromium.launch();

for (const [name, viewport, touch] of SCREENS) {
  console.log(`\non ${name}`);
  const { context, page, errors } = await openPage(browser, viewport, touch);

  for (let step = 1; step <= 4; step++) {
    const button = `[data-wizard-next="${step + 1}"]`;
    // Reach the button the way a parent would: scrolled to it.
    await page.$eval(button, (b) => b.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(150);
    if (touch) await page.tap(button); else await page.click(button);
    await page.waitForTimeout(1100);          // the slide, and the scroll

    const at = await whereIs(page, step + 1);
    check(`step ${step + 1}: lands with its top just under the header`,
      at.top >= at.header && at.top <= at.header + TOP_SLACK, `top ${at.top}px, header ${at.header}px`);
    check(`step ${step + 1}: all of it is on screen, its button included`,
      at.bottom <= at.screen && at.nextBottom <= at.screen, `bottom ${at.bottom}px of ${at.screen}px`);
  }
  check("no script errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

console.log("\na step that already fits");
{
  const { context, page } = await openPage(browser, { width: 390, height: 844 }, true);
  const before = await page.evaluate(() => scrollY);
  await page.tap('.stepper__dot[data-step="5"]');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => scrollY);
  check("doesn't move the page", before === after, `scrollY ${before} -> ${after}`);
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
