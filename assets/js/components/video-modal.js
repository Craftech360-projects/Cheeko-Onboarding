/**
 * components/video-modal.js
 * Simulated tutorial player. Any element carrying [data-video="<key>"]
 * opens the modal with the matching entry from TUTORIALS, so adding a
 * tutorial means adding one object here and one button in the markup.
 */

import { byId, qsa } from "../core/dom.js";
import { openModal } from "./modal.js";

const TUTORIALS = {
  wifi: {
    modalTitle: "Wi-Fi Connection Tutorial",
    icon: "📶",
    title: "Connecting Wi-Fi Guide",
    caption: "Hold ears for 3 seconds to trigger blue eyes pulsing, select network, and connect.",
  },
  pairing: {
    modalTitle: "Companion Pairing Tutorial",
    icon: "🔗",
    title: "Phone Pairing Guide",
    caption: "Linking phone Bluetooth to Cheeko and assigning child profile guidelines.",
  },
  explore: {
    modalTitle: "Exploring Story Cards Tutorial",
    icon: "🦊",
    title: "How to Play Cards",
    caption: "Slot card vertically, wait for LED verification, and loop story offline.",
  },
};

export function initVideoModal() {
  const modal = byId("videoModal");
  if (!modal) return;

  const elements = {
    modalTitle: byId("videoModalTitle"),
    icon: byId("videoStageIcon"),
    title: byId("videoStageTitle"),
    caption: byId("videoStageCaption"),
  };

  function openTutorial(key) {
    const tutorial = TUTORIALS[key] ?? TUTORIALS.explore;
    elements.modalTitle.textContent = tutorial.modalTitle;
    elements.icon.textContent = tutorial.icon;
    elements.title.textContent = tutorial.title;
    elements.caption.textContent = tutorial.caption;
    openModal(modal);
  }

  qsa("[data-video]").forEach((trigger) => {
    trigger.addEventListener("click", () => openTutorial(trigger.dataset.video));
  });
}
