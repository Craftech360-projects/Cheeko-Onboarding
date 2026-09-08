/**
 * components/faq-accordion.js
 * Single-open accordion for the FAQ panel.
 */

import { qs, qsa, setVisible } from "../core/dom.js";

const OPEN_CLASS = "accordion__item--open";
const MARKER_CLOSED = "▼";
const MARKER_OPEN = "▲";

export function initFaqAccordion() {
  const items = qsa(".accordion__item");

  function close(item) {
    item.classList.remove(OPEN_CLASS);
    setVisible(qs(".accordion__answer", item), false);
    qs(".accordion__marker", item).textContent = MARKER_CLOSED;
    qs(".accordion__question", item).setAttribute("aria-expanded", "false");
  }

  function open(item) {
    item.classList.add(OPEN_CLASS);
    setVisible(qs(".accordion__answer", item), true);
    qs(".accordion__marker", item).textContent = MARKER_OPEN;
    qs(".accordion__question", item).setAttribute("aria-expanded", "true");
  }

  function toggle(item) {
    const wasOpen = item.classList.contains(OPEN_CLASS);
    items.forEach(close);
    if (!wasOpen) open(item);
  }

  items.forEach((item) => {
    item.addEventListener("click", () => toggle(item));

    // The question is exposed as a button, so it must answer to the keys
    // a button answers to.
    qs(".accordion__question", item).addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle(item);
    });
  });
}
