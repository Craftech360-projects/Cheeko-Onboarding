/**
 * features/parent-auth.js
 * The sign-in / sign-up modal and the account modal's log-out action.
 *
 * Firebase is the source of truth for who is signed in. The button only
 * opens Google's chooser; everything after that — app state, closing the
 * card, the onboarding step — hangs off the auth-state listener, so a
 * session restored on page load takes exactly the same path as a fresh
 * sign-in.
 */

import { byId, setVisible } from "../core/dom.js";
import { openModal, closeModal } from "../components/modal.js";
import { signInWithGoogle, signOutOfFirebase, watchAuthState } from "../core/firebase.js";
import {
  appState, signIn, signOut, advanceToStep, DEFAULT_PARENT_NAME,
} from "../core/app-state.js";

const MODE = { SIGNIN: "signin", SIGNUP: "signup" };
const SIGNUP_CARD_CLASS = "auth-card--signup";
const STEP_AFTER_ACCOUNT = 3;

/** Everything that differs between the two modes, in one place. */
const COPY = {
  [MODE.SIGNIN]: {
    title: "Sign in",
    prompt: "New user?",
    switchLabel: "Sign up",
    switchTo: MODE.SIGNUP,
  },
  [MODE.SIGNUP]: {
    title: "Sign up",
    prompt: "Already have an account?",
    switchLabel: "Sign in",
    switchTo: MODE.SIGNIN,
  },
};

/** Firebase error codes the parent can actually do something about. */
const ERROR_COPY = {
  "auth/popup-blocked":
    "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed":
    "We could not reach Google. Check your connection and try again.",
  "auth/unauthorized-domain":
    "Sign-in is not enabled for this address yet. Please let us know at hello@altio.me.",
  "auth/operation-not-allowed":
    "Google sign-in is not switched on for this site yet. Please let us know at hello@altio.me.",
  // Firebase Authentication has not been enabled on the project at all.
  "auth/configuration-not-found":
    "Google sign-in is not switched on for this site yet. Please let us know at hello@altio.me.",
};

/** Closing the chooser is a choice, not a failure — say nothing. */
const SILENT_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

export function initParentAuth({ onSignIn, onSignOut } = {}) {
  const authModal = byId("authModal");
  const accountModal = byId("accountModal");
  if (!authModal) return {};

  const card = byId("authCard");
  const title = byId("authModalTitle");
  const switchPrompt = byId("authSwitchPrompt");
  const switchLabel = byId("authSwitchLabel");
  const switchButton = byId("authSwitchBtn");
  const googleButton = byId("authGoogleBtn");
  const errorBanner = byId("authError");

  let mode = MODE.SIGNIN;

  /** Paint the card for `nextMode` without opening or closing anything. */
  function renderMode(nextMode) {
    mode = nextMode;
    const copy = COPY[mode];

    title.textContent = copy.title;
    switchPrompt.textContent = copy.prompt;
    switchLabel.textContent = copy.switchLabel;
    card.classList.toggle(SIGNUP_CARD_CLASS, mode === MODE.SIGNUP);
    setVisible(errorBanner, false);
  }

  function openAuthModal(nextMode = MODE.SIGNIN) {
    renderMode(nextMode);
    openModal(authModal);
  }

  switchButton.addEventListener("click", () => renderMode(COPY[mode].switchTo));

  googleButton.addEventListener("click", async () => {
    setVisible(errorBanner, false);
    googleButton.disabled = true;

    try {
      await signInWithGoogle();
      // The auth-state listener below takes it from here.
    } catch (error) {
      if (SILENT_CODES.has(error?.code)) return;

      console.error("Google sign-in failed:", error);
      errorBanner.textContent = ERROR_COPY[error?.code]
        || "Something went wrong signing in. Please try again.";
      setVisible(errorBanner, true);
    } finally {
      googleButton.disabled = false;
    }
  });

  /* One path for both a fresh sign-in and a session restored on load. */
  watchAuthState((user) => {
    if (user) {
      signIn({
        name: user.displayName || DEFAULT_PARENT_NAME,
        email: user.email || "",
      });

      // Having an account *is* step 2 — carry the parent straight on.
      if (appState.onboardingStep === 2) advanceToStep(STEP_AFTER_ACCOUNT);

      closeModal(authModal);
      onSignIn?.();
    } else if (appState.isLoggedIn) {
      // Firebase says no session, so a stale local one must not survive.
      signOut();
      onSignOut?.();
    }
  }).catch((error) => {
    console.error("Firebase Auth could not load — sign-in is unavailable:", error);
  });

  const logoutButton = byId("logoutBtn");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      closeModal(accountModal);
      try {
        await signOutOfFirebase();
        // The listener clears local state.
      } catch (error) {
        // Never strand a parent in a session they asked to leave.
        console.error("Firebase sign-out failed, clearing locally:", error);
        signOut();
        onSignOut?.();
      }
    });
  }

  return { openAuthModal, openAccountModal: () => openModal(accountModal) };
}
