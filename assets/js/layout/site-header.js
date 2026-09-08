/**
 * layout/site-header.js
 * Header behaviour that is independent of the page's own state.
 */

import { qs, byId } from "../core/dom.js";

export function initSiteHeader() {
  /* The nav strip scrolls horizontally on small screens. Bring the
     current page into view so visitors can see where they are without
     having to swipe first. */
  const nav = byId("siteNav");
  if (!nav) return;

  const activeLink = qs(".site-nav__link--active", nav);
  if (!activeLink) return;

  const overflow = activeLink.offsetLeft + activeLink.offsetWidth - nav.clientWidth;
  if (overflow > 0) nav.scrollLeft = overflow + 16;
}
