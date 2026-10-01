/** Open a local video guide from its card and release it when the modal closes. */

import { byId, qsa } from "../core/dom.js";
import { openModal } from "./modal.js";

export function initVideoModal() {
  const modal = byId("videoModal");
  const video = byId("tutorialVideo");
  const title = byId("videoModalTitle");
  if (!modal || !video || !title) return;

  qsa(".video-card[data-video]").forEach((card) => {
    card.addEventListener("click", () => {
      video.src = card.dataset.video;
      video.poster = card.querySelector("img")?.src || "";
      title.textContent = card.querySelector(".video-card__title")?.textContent || "Video guide";
      openModal(modal);
      video.play().catch(() => {
        // Browser autoplay rules may require a second tap on the native controls.
      });
    });
  });

  modal.addEventListener("modal:close", () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
}
