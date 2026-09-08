/**
 * core/app-state.js
 * The page's whole persisted state, in one place.
 *
 * Every module reads `appState` and mutates it only through the setters
 * below, so persistence and change notification can never be forgotten
 * at a call site.
 */

import { storage } from "./storage.js";

const STORAGE_KEYS = {
  isLoggedIn:     "cheeko_parent_logged_in",
  parentName:     "cheeko_parent_name",
  parentEmail:    "cheeko_parent_email",
  onboardingStep: "cheeko_onboard_step",
};

export const DEFAULT_PARENT_NAME = "Parent";
export const FIRST_STEP = 1;
export const LAST_STEP = 5;

const listeners = new Set();

export const appState = {
  isLoggedIn:     storage.get(STORAGE_KEYS.isLoggedIn) === "true",
  parentName:     storage.get(STORAGE_KEYS.parentName) || DEFAULT_PARENT_NAME,
  parentEmail:    storage.get(STORAGE_KEYS.parentEmail) || "parent@example.com",
  onboardingStep: clampStep(parseInt(storage.get(STORAGE_KEYS.onboardingStep), 10)),
};

function clampStep(step) {
  if (!Number.isFinite(step)) return FIRST_STEP;
  return Math.min(Math.max(step, FIRST_STEP), LAST_STEP);
}

function notify() {
  listeners.forEach((listener) => listener(appState));
}

/** Register a callback fired after any state change. Returns an unsubscribe. */
export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function signIn({ name, email }) {
  appState.isLoggedIn = true;
  if (name)  appState.parentName = name;
  if (email) appState.parentEmail = email;

  storage.set(STORAGE_KEYS.isLoggedIn, "true");
  storage.set(STORAGE_KEYS.parentName, appState.parentName);
  storage.set(STORAGE_KEYS.parentEmail, appState.parentEmail);
  notify();
}

/** Sign out and clear the whole setup run, so onboarding starts fresh. */
export function signOut() {
  appState.isLoggedIn = false;
  appState.onboardingStep = FIRST_STEP;

  Object.values(STORAGE_KEYS).forEach((key) => {
    if (key !== STORAGE_KEYS.parentName && key !== STORAGE_KEYS.parentEmail) {
      storage.remove(key);
    }
  });
  notify();
}

/** Advance the wizard. Never moves backwards — completed steps stay done. */
export function advanceToStep(step) {
  const next = clampStep(step);
  if (next <= appState.onboardingStep) return;

  appState.onboardingStep = next;
  storage.set(STORAGE_KEYS.onboardingStep, next);
  notify();
}

/** The stored name, used to greet a returning parent on log in. */
export function getStoredParentName() {
  return storage.get(STORAGE_KEYS.parentName) || DEFAULT_PARENT_NAME;
}
