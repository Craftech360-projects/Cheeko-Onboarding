/**
 * components/video-modal.js
 * Simulated tutorial player. Any element carrying [data-video="<key>"]
 * opens the modal with the matching entry from TUTORIALS, so adding a
 * tutorial means adding one object here and one button in the markup.
 */

import { byId, qsa } from "../core/dom.js";
import { openModal } from "./modal.js";

// The tutorial videos are not recorded yet, so the cards are deliberately
// inert: clicking one does nothing. Flip this to true to wire the player
// back up — the modal, its markup and the TUTORIALS copy below all stay
// ready for that.
const PLAYER_ENABLED = false;

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
  "custom-card": {
    modalTitle: "Custom Card Tutorial",
    icon: "🎨",
    title: "Add a Custom Card",
    caption: "Create a card in the Studio, write it to a blank card, and slot it into Cheeko.",
  },
  explore: {
    modalTitle: "Exploring Story Cards Tutorial",
    icon: "🦊",
    title: "How to Play Cards",
    caption: "Slot card vertically, wait for LED verification, and loop story offline.",
  },
  "kid-profile": {
    modalTitle: "Kid Profile Tutorial",
    icon: "🧒",
    title: "Setup a New Kid Profile",
    caption: "Add a child in the companion app, set their age band, and pick safety limits.",
  },
  "remove-toy": {
    modalTitle: "Removing a Toy Tutorial",
    icon: "🔌",
    title: "Remove a Toy",
    caption: "Unpair Cheeko from the parent account and clear it for a new household.",
  },
};

export function initVideoModal() {
  if (!PLAYER_ENABLED) return;

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
