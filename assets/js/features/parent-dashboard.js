/**
 * features/parent-dashboard.js
 * The signed-in view: safety controls and the quick resource shortcuts
 * that deep-link into the support tabs below.
 */

import { byId, qsa } from "../core/dom.js";

const RECOMMENDED_VOLUME_MAX = 70;

export function initParentDashboard({ activateTab, openAccountModal } = {}) {
  const volumeSlider = byId("volumeCapSlider");
  const volumeValue = byId("volumeCapValue");

  if (volumeSlider && volumeValue) {
    volumeSlider.addEventListener("input", (event) => {
      const level = Number(event.target.value);
      const isLoud = level > RECOMMENDED_VOLUME_MAX;

      volumeValue.textContent = `${level}% (${isLoud ? "Loud Warning" : "Recommended"})`;
      volumeValue.classList.toggle("controls__value--warning", isLoud);
    });
  }

  qsa("#dashboardResources [data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab?.(button.dataset.tab, { scrollIntoView: true });
    });
  });

  const manageAccountButton = byId("manageAccountBtn");
  if (manageAccountButton && openAccountModal) {
    manageAccountButton.addEventListener("click", openAccountModal);
  }
}
