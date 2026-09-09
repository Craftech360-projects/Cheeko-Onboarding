// Does clicking the policy link inside the consent <label> also tick
// the checkbox? A parent reading the policy must not be recorded as
// having accepted it.
//
// The href stays on: an <a href> is "interactive content" and an <a>
// without one is not, so removing it to stop the navigation would test
// something other than what ships. The new tab is allowed to open and
// closed again instead.
import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Don't actually fetch Notion.
await ctx.route("https://cheekoai-parental-app.notion.site/**", (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: "<title>policy</title>" }));

await page.goto("http://localhost:3000/index.html");
await page.evaluate(() => {
  document.getElementById("authModal").classList.add("modal--open");
  document.getElementById("authChoose").classList.add("is-hidden");
  document.getElementById("authRegisterForm").classList.remove("is-hidden");
});

let fails = 0;
const ok = (v, msg) => { if (!v) fails += 1; console.log(`  ${v ? "PASS" : "FAIL"}  ${msg}`); };

for (const [box, text] of [["consentPrivacy", "Privacy Policy"], ["consentTerms", "Terms of Service"]]) {
  await page.uncheck(`#${box}`).catch(() => {});
  const before = await page.isChecked(`#${box}`);

  const [popup] = await Promise.all([
    page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
    page.click(`.consent a:text("${text}")`),
  ]);
  const after = await page.isChecked(`#${box}`);

  ok(popup !== null, `"${text}" opens a new tab`);
  ok(before === after, `clicking "${text}" leaves #${box} untouched (${before} -> ${after})`);
  if (popup) await popup.close();

  // The sentence itself must still be a hit target. Click near the
  // start of the text, not the span's centre — the link sits there now,
  // and hitting it would just be the check above again.
  const span = page.locator(`label:has(#${box}) span`);
  const box2 = await span.boundingBox();
  await page.mouse.click(box2.x + 12, box2.y + 8);
  ok(await page.isChecked(`#${box}`), `the sentence still ticks #${box}`);
}

await browser.close();
process.exit(fails ? 1 : 0);
