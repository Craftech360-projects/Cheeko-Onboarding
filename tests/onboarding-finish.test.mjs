/**
 * "Finish Onboarding": step 5 swaps its actions for a confirmation, in
 * place, with "View Device Info" beside it. Remembered across reloads,
 * and cleared by signing out like the rest of the setup run.
 *
 * Firebase is stubbed (signed out) and the API is the stand-in, so this
 * runs with no network — nothing here needs an account.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3000";

const STUB = `
export async function signInWith() { return null; }
export async function signOutOfFirebase() {}
export async function getIdToken() { return null; }
export async function watchAuthState(l) { setTimeout(() => l(null), 0); return () => {}; }
`;

const DONE = '[data-finish-view="done"]';
const TO_DEVICES = '[data-scroll-to="deviceInfoSection"]';

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

async function openPage(context) {
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
  await page.goto(`${ORIGIN}/index.html?api=standin`);
  await page.waitForSelector("#finishOnboardingBtn", { state: "attached" });
  return { page, errors };
}

/** Go to step 5 the way a parent can: its dot on the rail. */
async function toStepFive(page) {
  await page.click('.stepper__dot[data-step="5"]');
  await page.waitForTimeout(650);             // the slide
}

const browser = await chromium.launch();

console.log("\nfinishing, on a laptop");
const laptop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
{
  const { page, errors } = await openPage(laptop);
  check("the confirmation starts hidden", !(await page.isVisible(DONE)));

  await toStepFive(page);
  await page.click("#finishOnboardingBtn");
  await page.waitForTimeout(150);             // the viewport's resize

  check("the confirmation shows", await page.isVisible(DONE));
  check("it says setup is done", (await page.textContent("#finishTitle")).includes("all set up"),
    await page.textContent("#finishTitle"));
  check("the Finish and catalog buttons are gone",
    !(await page.isVisible("#finishOnboardingBtn")) && !(await page.isVisible('a[href*="cards.html"]')));
  check("focus moves to the confirmation", (await page.evaluate(() => document.activeElement?.id)) === "finishTitle");
  check("step 5 is ticked on the rail",
    (await page.getAttribute('.stepper__dot[data-step="5"]', "class")).includes("stepper__dot--complete"));
  check("the card grew to fit it, nothing clipped", await page.evaluate(() => {
    const viewport = document.getElementById("wizardViewport");
    const panel = document.querySelectorAll(".wizard__panel")[4];
    return Math.abs(viewport.offsetHeight - panel.offsetHeight) <= 1;
  }));

  const button = await page.$(TO_DEVICES);
  const copy = await page.$(".step-done__copy");
  const [b, c] = [await button.boundingBox(), await copy.boundingBox()];
  check("View Device Info sits beside the message",
    b.x >= c.x + c.width - 1 && b.y < c.y + c.height && b.y + b.height > c.y, JSON.stringify({ b, c }));

  await page.click(TO_DEVICES);
  await page.waitForTimeout(1200);            // the smooth scroll
  const top = await page.evaluate(() => document.getElementById("deviceInfoSection").getBoundingClientRect().top);
  check("it takes the parent to Device Info", top > -2 && top < 200, `section top=${Math.round(top)}px`);
  check("the Device Info title isn't hidden under the header", await page.evaluate(() => {
    const title = document.querySelector(".device-info__title").getBoundingClientRect();
    const header = document.querySelector("header")?.getBoundingClientRect();
    return !header || title.top >= header.bottom - 1;
  }));
  check("and focus lands on its heading",
    (await page.evaluate(() => document.activeElement?.classList.contains("device-info__title"))) === true);
  check("no script errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

console.log("\nremembered, and reset by signing out");
{
  const { page } = await openPage(laptop);
  check("after a reload it is still finished", await page.isVisible(DONE));
  check("and step 5 still ticked",
    (await page.getAttribute('.stepper__dot[data-step="5"]', "class")).includes("stepper__dot--complete"));
  await page.evaluate(async () => (await import("/assets/js/core/app-state.js")).signOut());
  check("signing out brings the Finish button back",
    (await page.isVisible("#finishOnboardingBtn")) && !(await page.isVisible(DONE)));
  await page.close();
}
{
  const { page } = await openPage(laptop);
  check("and a reload after that stays unfinished", !(await page.isVisible(DONE)));
  await page.close();
}
await laptop.close();

console.log("\non a phone");
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const { page } = await openPage(phone);
  await toStepFive(page);
  await page.click("#finishOnboardingBtn");
  await page.waitForTimeout(150);
  const [b, c] = [await (await page.$(TO_DEVICES)).boundingBox(), await (await page.$(".step-done__copy")).boundingBox()];
  check("View Device Info stacks under the message, full width",
    b.y >= c.y + c.height - 1 && Math.abs(b.width - c.width) <= 2, JSON.stringify({ b, c }));
  await phone.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\nFailures:");
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`));
  process.exit(1);
}
