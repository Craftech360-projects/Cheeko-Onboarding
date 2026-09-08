/**
 * components/info-tabs.js
 * The support documentation tab strip.
 *
 * Returns an `activateTab` handle so other views (the dashboard's quick
 * resource shortcuts) can jump straight to a panel without reaching into
 * the DOM themselves.
 */

import { qs, qsa, setVisible } from "../core/dom.js";

const ACTIVE_TAB_CLASS = "tabs__tab--active";

export function initInfoTabs() {
  const tabList = qs("#infoTabs");
  if (!tabList) return { activateTab: () => {} };

  const tabs = qsa(".tabs__tab", tabList);
  const panels = qsa(".tab-panel");

  function activateTab(tabName, { scrollIntoView = false } = {}) {
    const target = tabs.find((tab) => tab.dataset.tab === tabName);
    if (!target) return;

    tabs.forEach((tab) => {
      const isActive = tab === target;
      tab.classList.toggle(ACTIVE_TAB_CLASS, isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    panels.forEach((panel) => {
      setVisible(panel, panel.id === `panel-${tabName}`);
    });

    if (scrollIntoView) {
      tabList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Keep the chosen tab visible in the horizontally scrolling strip.
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  return { activateTab };
}
