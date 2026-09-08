/**
 * core/dom.js
 * Thin query helpers so modules read as intent rather than boilerplate.
 */

/** First match, or null. */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** All matches as a real array (so .map/.filter work). */
export const qsa = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

/** Element by id, or null. */
export const byId = (id) => document.getElementById(id);

/**
 * Show or hide an element without hard-coding a display value, so each
 * component keeps whatever display its stylesheet gave it.
 */
export function setVisible(element, visible) {
  if (element) element.classList.toggle("is-hidden", !visible);
}
