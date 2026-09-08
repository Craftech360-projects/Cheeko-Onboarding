/**
 * components/modal.js
 * Open/close behaviour shared by every .modal on the page: backdrop
 * click, Escape, body scroll lock and focusing the first field.
 */

import { qs, qsa } from "../core/dom.js";

const OPEN_CLASS = "modal--open";
const BODY_LOCK_CLASS = "is-modal-open";
const FOCUSABLE = "input, select, textarea, button";

export function openModal(modal) {
  if (!modal) return;
  modal.classList.add(OPEN_CLASS);
  document.body.classList.add(BODY_LOCK_CLASS);

  const first = qs(FOCUSABLE, modal);
  if (first) setTimeout(() => first.focus(), 60);
}

export function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove(OPEN_CLASS);
  if (!qs(`.${OPEN_CLASS}`)) document.body.classList.remove(BODY_LOCK_CLASS);
}

export function closeAllModals() {
  qsa(`.${OPEN_CLASS}`).forEach(closeModal);
}

/**
 * Wire the behaviour every modal shares. Call once on boot.
 * Close buttons are found by [data-modal-close], so new modals need no
 * extra JavaScript.
 */
export function initModals() {
  qsa(".modal").forEach((modal) => {
    // Backdrop click only — a click inside the dialog must not close it.
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  qsa("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.closest(".modal")));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllModals();
  });
}
