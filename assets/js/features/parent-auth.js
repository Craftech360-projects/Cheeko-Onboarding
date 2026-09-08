/**
 * features/parent-auth.js
 * The sign-up / log-in modal and the account modal's log-out action.
 *
 * This is a front-end demo: no credentials leave the page. It records
 * who the parent said they are so the rest of the UI can greet them.
 */

import { byId, setVisible } from "../core/dom.js";
import { openModal, closeModal } from "../components/modal.js";
import {
  appState, signIn, signOut, advanceToStep, getStoredParentName, DEFAULT_PARENT_NAME,
} from "../core/app-state.js";

const MODE = { SIGNUP: "signup", LOGIN: "login" };
const ACTIVE_OPTION_CLASS = "segmented__option--active";
const STEP_AFTER_ACCOUNT = 3;

export function initParentAuth({ onSignIn, onSignOut } = {}) {
  const authModal = byId("authModal");
  const accountModal = byId("accountModal");
  if (!authModal) return {};

  const form = byId("authForm");
  const headline = byId("authModalTitle");
  const submitButton = byId("authSubmitBtn");
  const nameField = byId("authNameField");
  const nameInput = byId("authNameInput");
  const emailInput = byId("authEmailInput");
  const passwordInput = byId("authPasswordInput");
  const signupTab = byId("authSignupTab");
  const loginTab = byId("authLoginTab");

  let mode = MODE.SIGNUP;

  function openAuthModal(nextMode = MODE.SIGNUP) {
    mode = nextMode;
    const isSignup = mode === MODE.SIGNUP;

    headline.textContent = isSignup ? "Create Account" : "Parent Log In";
    submitButton.textContent = isSignup ? "Create Account" : "Log In";
    setVisible(nameField, isSignup);
    nameInput.required = isSignup;

    signupTab.classList.toggle(ACTIVE_OPTION_CLASS, isSignup);
    loginTab.classList.toggle(ACTIVE_OPTION_CLASS, !isSignup);

    openModal(authModal);
  }

  signupTab.addEventListener("click", () => openAuthModal(MODE.SIGNUP));
  loginTab.addEventListener("click", () => openAuthModal(MODE.LOGIN));

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    signIn({
      name: mode === MODE.SIGNUP
        ? nameInput.value.trim() || DEFAULT_PARENT_NAME
        : getStoredParentName(),
      email: emailInput.value.trim(),
    });

    form.reset();
    closeModal(authModal);

    // Creating the account *is* step 2 — carry the parent straight on.
    if (appState.onboardingStep === 2) advanceToStep(STEP_AFTER_ACCOUNT);
    onSignIn?.();
  });

  const logoutButton = byId("logoutBtn");
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      signOut();
      closeModal(accountModal);
      onSignOut?.();
    });
  }

  return { openAuthModal, openAccountModal: () => openModal(accountModal) };
}
