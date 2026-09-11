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

import { byId } from "./core/dom.js";
import { appState, onStateChange } from "./core/app-state.js";

import { initModals } from "./components/modal.js";
import { initInfoTabs } from "./components/info-tabs.js";
import { initFaqAccordion } from "./components/faq-accordion.js";
import { initVideoModal } from "./components/video-modal.js";

import { initOnboardingWizard } from "./features/onboarding-wizard.js";
import { initParentAuth } from "./features/parent-auth.js";
import { initParentDashboard } from "./features/parent-dashboard.js";
import { initSupportForms } from "./features/support-forms.js";
import { initDeviceInfo } from "./features/device-info.js";


/**
 * Show an email with a line-break hint just before its "@", so a long one
 * wraps as "name" / "@domain" instead of mid-word. A <wbr> has no text, so
 * the element's textContent is still exactly the email.
 */
function setEmail(element, email) {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    element.textContent = email;
    return;
  }
  element.replaceChildren(email.slice(0, at), document.createElement("wbr"), email.slice(at));
}

/** "Walter White" -> "WW", "Priya" -> "P": the account modal's avatar. */
function initialsOf(name) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
  return initials.toUpperCase() || "?";
}


function boot() {

  const headerAccountButton = byId("headerAccountBtn");
  const headerAccountLabel = byId("headerAccountLabel");
  const profileName = byId("profileName");
  const profileEmail = byId("profileEmail");
  const profilePhone = byId("profilePhone");
  const profileLanguage = byId("profileLanguage");
  const profileAvatar = byId("profileAvatar");


  // iOS Safari applies :active on touch only when a touchstart listener
  // exists above the element, and every press state in the CSS relies on
  // :active. The listener itself does nothing.
  document.addEventListener("touchstart", () => {}, { passive: true });

  initModals();
  initFaqAccordion();
  initVideoModal();
  initSupportForms();

  const { activateTab } = initInfoTabs();

  // "Finish Onboarding" confirms in place and offers the way to Device Info.
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

  // Follows Firebase's sign-in state on its own; see the module header.
  initDeviceInfo({ openAuthModal: () => auth.openAuthModal() });

  headerAccountButton.addEventListener("click", () => {
    if (appState.isLoggedIn) auth.openAccountModal();
    else auth.openAuthModal();
  });

  /**
   * The page itself reads the same signed in or out. Signing in only
   * changes the header button and fills in the account modal with the
   * details the parent registered.
   */
  function render() {
    const {
      isLoggedIn, parentName, parentEmail, parentPhone, parentLanguage,
    } = appState;

    // An icon button: the state is its hidden label and its tooltip,
    // and a dot on the icon marks a signed-in parent.
    const accountLabel = isLoggedIn ? "Profile" : "Sign in";
    headerAccountLabel.textContent = accountLabel;
    headerAccountButton.title = accountLabel;
    headerAccountButton.classList.toggle("account-button--signed-in", isLoggedIn);

    if (isLoggedIn) {
      // The registered profile, as the parent-profile API returned it.
      // A field the account was created without shows as "Not set"
      // rather than blank, so the row does not read as a bug.
      //
      // The language row is hidden in the markup for now. It is still
      // filled in, so un-hiding it needs no change here.
      profileName.textContent = parentName;
      profileAvatar.textContent = initialsOf(parentName);
      setEmail(profileEmail, parentEmail);
      profilePhone.textContent = parentPhone || "Not set";
      profileLanguage.textContent = parentLanguage || "Not set";
    }

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
