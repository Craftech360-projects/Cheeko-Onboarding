import assert from "node:assert/strict";
import { chromium } from "playwright";

const CDN_BASE = "https://dsmzc13oafp54.cloudfront.net/website-media/start.cheekoai.in/";

const guides = [
  ["Meet Cheeko", "v20-meet-cheeko.mp4", "v20-meet-cheeko-thumbnail.png", "0:52"],
  ["Switch On and Learn to Play", "v21-switch-on-and-learn-to-play.mp4", "v21-switch-on-and-learn-to-play-thumbnail.png", "0:43"],
  ["Connect Cheeko", "v22-connect-cheeko.mp4", "v22-connect-cheeko-thumbnail.png", "0:44"],
  ["Your First Five Minutes", "v23-your-first-five-minutes.mp4", "v23-your-first-five-minutes-thumbnail.png", "0:44"],
  ["Cheeko App Guide", "v25-cheeko-app-guide.mp4", "v25-cheeko-app-guide-thumbnail.png", "2:37"],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/index.html?api=standin", { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#videoModal .modal__header").count(), 0, "player has no header strip");
  const pairingImage = page.locator('.wizard__panel').nth(3).locator('.screen-showcase__shot');
  assert.ok((await pairingImage.getAttribute("src")).includes("07_01_54%20PM.png"), "pairing screen uses the new framed PNG");
  assert.ok(await pairingImage.evaluate((img) => img.complete && img.naturalWidth > 0), "pairing image loads");
  const cards = page.locator(".video-scroller .video-card");
  assert.equal(await cards.count(), guides.length, "one card per supplied video");

  for (const [index, [title, filename, thumbnailName, duration]] of guides.entries()) {
    const card = cards.nth(index);
    assert.equal((await card.locator(".video-card__title").textContent()).trim(), title);
    assert.equal((await card.locator(".video-card__duration").textContent()).trim(), duration);
    assert.equal(await card.locator(".video-card__play").count(), 1, `${title} has a play button`);

    const thumbnail = card.locator("img");
    assert.equal(await thumbnail.getAttribute("src"), `${CDN_BASE}${thumbnailName}`, `${title} has its matching artwork`);
    await thumbnail.scrollIntoViewIfNeeded();
    await thumbnail.evaluate((img) => img.decode());
    assert.ok(await thumbnail.evaluate((img) => img.complete && img.naturalWidth > 0), `${title} artwork loads`);

    await card.click();
    await page.locator("#videoModal.modal--open").waitFor();
    assert.equal((await page.locator("#videoModalTitle").textContent()).trim(), title);
    assert.equal(await page.locator("#tutorialVideo").getAttribute("src"), `${CDN_BASE}${filename}`, `${title} opens its MP4`);
    await page.waitForFunction(() => Number.isFinite(document.getElementById("tutorialVideo").duration));
    const actualDuration = await page.locator("#tutorialVideo").evaluate((video) => {
      const seconds = Math.round(video.duration);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    });
    assert.equal(actualDuration, duration, `${title} shows its actual runtime`);
    if (index === 0) {
      await page.waitForFunction(() => {
        const video = document.getElementById("tutorialVideo");
        return video.readyState >= 2 && !video.paused;
      });
    }
    await page.locator("#videoModal [data-modal-close]").click();
    assert.equal(await page.locator("#tutorialVideo").getAttribute("src"), null, `${title} releases video on close`);
  }
} finally {
  await browser.close();
}

console.log("Video guides: five matching cards, loaded media and runtimes, playback, and modal cleanup passed.");
