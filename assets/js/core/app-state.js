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
  parentPhone:    "cheeko_parent_phone",
  parentLanguage: "cheeko_parent_language",
  onboardingStep: "cheeko_onboard_step",
  onboardingComplete: "cheeko_onboard_complete",
};

export const DEFAULT_PARENT_NAME = "Parent";
export const FIRST_STEP = 1;
export const LAST_STEP = 5;

const listeners = new Set();

export const appState = {
  isLoggedIn:     storage.get(STORAGE_KEYS.isLoggedIn) === "true",
  parentName:     storage.get(STORAGE_KEYS.parentName) || DEFAULT_PARENT_NAME,
  parentEmail:    storage.get(STORAGE_KEYS.parentEmail) || "parent@example.com",
  parentPhone:    storage.get(STORAGE_KEYS.parentPhone) || "",
  parentLanguage: storage.get(STORAGE_KEYS.parentLanguage) || "",
  onboardingStep: clampStep(parseInt(storage.get(STORAGE_KEYS.onboardingStep), 10)),
  onboardingComplete: storage.get(STORAGE_KEYS.onboardingComplete) === "true",
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

/**
 * Mark the parent signed in and cache their details for the header and
 * the account modal.
 *
 * The registered profile in `core/parent-directory.js` is the source of
 * truth for all of this; what is stored here is only a copy, so the
 * account modal can paint before the next lookup returns. Fields left
 * out keep whatever they had, which is what lets a Firebase-only detail
 * (the email) arrive before the profile does.
 */
export function signIn({ name, email, phone, language } = {}) {
  appState.isLoggedIn = true;
  if (name)     appState.parentName     = name;
  if (email)    appState.parentEmail    = email;
  if (phone)    appState.parentPhone    = phone;
  if (language) appState.parentLanguage = language;

  storage.set(STORAGE_KEYS.isLoggedIn, "true");
  storage.set(STORAGE_KEYS.parentName, appState.parentName);
  storage.set(STORAGE_KEYS.parentEmail, appState.parentEmail);
  storage.set(STORAGE_KEYS.parentPhone, appState.parentPhone);
  storage.set(STORAGE_KEYS.parentLanguage, appState.parentLanguage);
  notify();
}

/**
 * Sign out and clear the whole setup run, so onboarding starts fresh.
 *
 * The name and email survive on purpose — they greet a returning parent
 * before the profile lookup finishes. The phone number does not: it is
 * of no use to a signed-out page, and devices get shared.
 */
export function signOut() {
  appState.isLoggedIn = false;
  appState.onboardingStep = FIRST_STEP;
  appState.onboardingComplete = false;
  appState.parentPhone = "";
  appState.parentLanguage = "";

  const kept = [STORAGE_KEYS.parentName, STORAGE_KEYS.parentEmail];
  Object.values(STORAGE_KEYS).forEach((key) => {
    if (!kept.includes(key)) storage.remove(key);
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

/**
 * Mark setup finished: every step done, and "Finish Onboarding" pressed.
 * Remembered like the step, and cleared by signOut() with the rest of
 * the run.
 */
export function completeOnboarding() {
  appState.onboardingStep = LAST_STEP;
  appState.onboardingComplete = true;
  storage.set(STORAGE_KEYS.onboardingStep, LAST_STEP);
  storage.set(STORAGE_KEYS.onboardingComplete, "true");
  notify();
}

/** The stored name, used to greet a returning parent on log in. */
export function getStoredParentName() {
  return storage.get(STORAGE_KEYS.parentName) || DEFAULT_PARENT_NAME;
}
