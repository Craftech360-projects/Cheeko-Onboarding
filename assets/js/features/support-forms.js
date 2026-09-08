/**
 * features/support-forms.js
 * Warranty registration and the support ticket form.
 *
 * Both are demo forms: on submit the form is swapped for its success
 * banner. Wired generically via [data-success-message] so a new form
 * needs no new JavaScript.
 */

import { byId, qsa, setVisible } from "../core/dom.js";

export function initSupportForms() {
  qsa("[data-success-message]").forEach((form) => {
    const banner = byId(form.dataset.successMessage);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      setVisible(form, false);
      setVisible(banner, true);
    });
  });
}
