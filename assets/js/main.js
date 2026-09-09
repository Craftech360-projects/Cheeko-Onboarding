/**
 * main.js
 * Entry point. Boots every module and owns the one piece of coordination
 * they all share: which of the two top-level views is on screen.
 *
 * Module map
 *   core/*        storage, persisted state, DOM helpers
 *   components/*  reusable UI blocks (modal, tabs, accordion, video)
 *   features/*    this page's screens (wizard, auth, dashboard)
 */

import { byId, setVisible } from "./core/dom.js";
import { appState, onStateChange } from "./core/app-state.js";

import { initModals } from "./components/modal.js";
import { initInfoTabs } from "./components/info-tabs.js";
import { initFaqAccordion } from "./components/faq-accordion.js";
import { initVideoModal } from "./components/video-modal.js";

import { initOnboardingWizard } from "./features/onboarding-wizard.js";
import { initParentAuth } from "./features/parent-auth.js";
import { initParentDashboard } from "./features/parent-dashboard.js";
import { initSupportForms } from "./features/support-forms.js";


function boot() {
  const onboardingView = byId("onboardingView");
  const dashboardView = byId("dashboardView");

  const headerAccountButton = byId("headerAccountBtn");
  const welcomeHeading = byId("welcomeHeading");
  const profileName = byId("profileName");
  const profileEmail = byId("profileEmail");

  const stepAccountSuccess = byId("stepAccountSuccess");

  initModals();
  initFaqAccordion();
  initVideoModal();
  initSupportForms();

  const { activateTab } = initInfoTabs();

  // "Finish Onboarding" is deliberately inert: no modal, no navigation.
  const wizard = initOnboardingWizard();

  const auth = initParentAuth({
    // Signing in can complete step 2, so let the wizard catch up.
    onSignIn: () => wizard.refresh(),
    onSignOut: () => wizard.refresh(),
  });

  initParentDashboard({
    activateTab,
    openAccountModal: auth.openAccountModal,
  });

  headerAccountButton.addEventListener("click", () => {
    if (appState.isLoggedIn) auth.openAccountModal();
    else auth.openAuthModal();
  });

  /** Swap between the onboarding wizard and the parent dashboard. */
  function render() {
    const { isLoggedIn, parentName, parentEmail } = appState;

    setVisible(onboardingView, !isLoggedIn);
    setVisible(dashboardView, isLoggedIn);

    headerAccountButton.textContent = isLoggedIn ? "Profile" : "Sign in";

    if (isLoggedIn) {
      welcomeHeading.textContent = `Welcome back, ${parentName}!`;
      profileName.textContent = parentName;
      profileEmail.textContent = parentEmail;
    }

    // Step 2 confirms itself once the parent account exists.
    setVisible(stepAccountSuccess, isLoggedIn);

    // Never reposition the slider from here: a parent browsing back
    // through completed steps must not be yanked forward by a state
    // change elsewhere on the page.
    wizard.refresh({ goToCurrentStep: false });
  }

  onStateChange(render);
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
