/**
 * features/parent-auth.js
 * The sign-in / sign-up / register card, and the account modal's log-out
 * action.
 *
 * TWO QUESTIONS, NOT ONE
 * Google tells us *who* someone is. It does not tell us whether they
 * have a Cheeko account — the popup happily mints a Firebase record for
 * an address we have never seen. So every sign-in asks a second
 * question, of `core/parent-directory.js`, which puts it to the same
 * parent-profile API the Parent App uses: is there a profile for this
 * uid?
 *
 *   profile found    -> signed in, their saved details on screen.
 *                       A parent who registered on the phone lands
 *                       here on their first web sign-in, because it is
 *                       one account and one API.
 *   no profile       -> the card says so and swaps itself for the
 *                       registration form (name, mobile, language,
 *                       consents), field for field the Parent App's
 *                       "Welcome to Cheeko" screen. What it posts is
 *                       the record the app will read next time it
 *                       opens.
 *   lookup failed    -> neither, and the parent is told to retry.
 *                       "We could not ask" must never be mistaken for
 *                       "you are new", which would walk a registered
 *                       parent into signing up again. The app hit this
 *                       exact bug and fixed it the same way — see
 *                       `decideSplashRoute`'s connectionRetry.
 *
 * ONE FUNNEL
 * The provider buttons only open Google's window. Everything after
 * that — the lookup, the branch, app state, closing the card, the
 * onboarding step — hangs off the auth-state listener, so a session
 * restored on page load takes exactly the same path as a fresh
 * sign-in.
 */

import { byId, setVisible } from "../core/dom.js";
import { openModal, closeModal, isModalOpen } from "../components/modal.js";
import {
  signInWith, signOutOfFirebase, watchAuthState,
} from "../core/firebase.js";
import {
  fetchParentProfile, createParentProfile, isProfileComplete,
} from "../core/parent-directory.js";
import {
  appState, signIn, signOut, advanceToStep, DEFAULT_PARENT_NAME,
} from "../core/app-state.js";

const MODE = { SIGNIN: "signin", SIGNUP: "signup", REGISTER: "register" };
const SIGNUP_CARD_CLASS = "auth-card--signup";
const STEP_AFTER_ACCOUNT = 3;

const MIN_NAME_LENGTH = 2;
const SUBMIT_IDLE_LABEL = "Continue";
const SUBMIT_BUSY_LABEL = "Creating your account…";

/** Everything that differs between the three modes, in one place. */
const COPY = {
  [MODE.SIGNIN]: {
    title: "Sign in",
    subtitle: "",
    prompt: "New user?",
    switchLabel: "Sign up",
    switchTo: MODE.SIGNUP,
    // Apple's guidelines want the verb to match the action. Google's
    // "Continue with" is theirs, and reads correctly either way.
    appleLabel: "Sign in with Apple",
  },
  [MODE.SIGNUP]: {
    title: "Sign up",
    subtitle: "",
    prompt: "Already have an account?",
    switchLabel: "Sign in",
    switchTo: MODE.SIGNIN,
    appleLabel: "Sign up with Apple",
  },
  [MODE.REGISTER]: {
    // Word for word the Parent App's registration screen.
    title: "Welcome to Cheeko",
    subtitle: "A few details and your child's Cheeko is ready to go.",
  },
};

/**
 * Firebase error codes the parent can actually do something about.
 * `{provider}` is filled in with the button they pressed.
 */
const ERROR_COPY = {
  "auth/popup-blocked":
    "Your browser blocked the {provider} window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed":
    "We could not reach {provider}. Check your connection and try again.",
  "auth/unauthorized-domain":
    "Sign-in is not enabled for this address yet. Please let us know at hello@altio.me.",
  "auth/operation-not-allowed":
    "That sign-in option is not switched on for this site yet. Please let us know at hello@altio.me.",
  // Firebase Authentication has not been enabled on the project at all.
  "auth/configuration-not-found":
    "Sign-in is not switched on for this site yet. Please let us know at hello@altio.me.",
  // Same email, other provider — only possible now that there are two.
  "auth/account-exists-with-different-credential":
    "You already have an account with that email. Try the other button to sign in.",
};

/** Closing the chooser is a choice, not a failure — say nothing. */
const SILENT_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

const LOOKUP_FAILED_COPY =
  "We could not check your Cheeko account just now. Check your connection and press the button again.";

const REGISTER_FAILED_COPY =
  "We could not create your account just now. Check your connection and try again.";

/** Just the digits, so spaces and dashes in a typed number don't count. */
const digitsOf = (value) => value.replace(/\D/g, "");

export function initParentAuth({ onSignIn, onSignOut } = {}) {
  const authModal = byId("authModal");
  const accountModal = byId("accountModal");
  if (!authModal) return {};

  const card = byId("authCard");
  const title = byId("authModalTitle");
  const subtitle = byId("authSubtitle");
  const notice = byId("authNotice");
  const errorBanner = byId("authError");

  const chooseStep = byId("authChoose");
  const switchPrompt = byId("authSwitchPrompt");
  const switchLabel = byId("authSwitchLabel");
  const switchButton = byId("authSwitchBtn");
  const appleLabel = byId("authAppleLabel");

  const registerForm = byId("authRegisterForm");
  const registerEmail = byId("authRegisterEmail");
  const registerError = byId("authRegisterError");
  const registerSubmit = byId("authRegisterSubmit");
  const registerCancel = byId("authRegisterCancelBtn");
  const nameInput = byId("registerName");
  const countrySelect = byId("registerCountry");
  const phoneInput = byId("registerPhone");
  const languageSelect = byId("registerLanguage");
  const requiredConsents = registerForm
    ? Array.from(registerForm.querySelectorAll("[data-consent-required]"))
    : [];

  let mode = MODE.SIGNIN;

  /**
   * A Firebase session that is not yet a Cheeko account.
   *
   * `awaitingRegistration` is the difference between "the lookup came
   * back empty, show them the form" and "the lookup never answered, ask
   * again before deciding anything".
   */
  let pendingUser = null;
  let awaitingRegistration = false;

  /**
   * True when the parent-profile row already exists and is merely
   * empty, so submitting the form has to update it rather than create
   * it. Set from the lookup, not guessed from an error code.
   */
  let hasExistingRow = false;

  /* ==========================================================
     Painting the card
     ========================================================== */

  function clearBanners() {
    setVisible(notice, false);
    setVisible(errorBanner, false);
    setVisible(registerError, false);
  }

  function showError(banner, message) {
    banner.textContent = message;
    setVisible(banner, true);
  }

  /** Paint the card for `nextMode` without opening or closing anything. */
  function renderMode(nextMode) {
    mode = nextMode;
    const copy = COPY[mode];
    const isRegister = mode === MODE.REGISTER;

    title.textContent = copy.title;
    subtitle.textContent = copy.subtitle;
    setVisible(subtitle, Boolean(copy.subtitle));

    setVisible(chooseStep, !isRegister);
    setVisible(registerForm, isRegister);

    if (!isRegister) {
      switchPrompt.textContent = copy.prompt;
      switchLabel.textContent = copy.switchLabel;
      if (appleLabel) appleLabel.textContent = copy.appleLabel;
    }

    card.classList.toggle(SIGNUP_CARD_CLASS, mode === MODE.SIGNUP);
  }

  /* ==========================================================
     Provider buttons

     Both are disabled while either is in flight, so a second click
     cannot open a competing popup. A successful popup leaves them
     disabled on purpose: the profile lookup is still running, and
     `settle()` is what hands the card back.
     ========================================================== */

  const providerButtons = [
    { button: byId("authGoogleBtn"), provider: "google", label: "Google" },
    { button: byId("authAppleBtn"), provider: "apple", label: "Apple" },
  ].filter((entry) => entry.button);

  function setProvidersBusy(busy) {
    providerButtons.forEach(({ button }) => { button.disabled = busy; });
  }

  providerButtons.forEach(({ button, provider, label }) => {
    button.addEventListener("click", async () => {
      clearBanners();
      setProvidersBusy(true);

      try {
        await signInWith(provider);
        // Signed in with the provider. Whether that is a Cheeko account
        // is the listener's question — leave the buttons busy until it
        // answers.
      } catch (error) {
        setProvidersBusy(false);

        if (SILENT_CODES.has(error?.code)) {
          // Nothing to say to the parent, but never vanish without a
          // trace: Apple can report a real failure as a closed popup.
          console.warn(`${label} sign-in dismissed:`, error?.code);
          return;
        }

        console.error(`${label} sign-in failed:`, error);
        const copy = ERROR_COPY[error?.code]
          || "Something went wrong signing in. Please try again.";
        showError(errorBanner, copy.replace("{provider}", label));
      }
    });
  });

  switchButton.addEventListener("click", () => {
    clearBanners();
    renderMode(COPY[mode].switchTo);
  });

  /* ==========================================================
     Registration form
     ========================================================== */

  const selectedCountry = () => countrySelect.selectedOptions[0];

  /**
   * How many digits the selected country's numbers have. The Parent App
   * validates every country as exactly ten (`isValidLocalPhoneNumber`),
   * so ten is the fallback and the markup only overrides it where a
   * country genuinely differs.
   */
  function expectedDigits() {
    return Number(selectedCountry()?.dataset.digits) || 10;
  }

  /**
   * Which fields are not yet fit to send. Returns a list of field
   * elements so the caller can both gate the button and mark them.
   */
  function invalidFields() {
    const invalid = [];
    if (nameInput.value.trim().length < MIN_NAME_LENGTH) invalid.push(nameInput);
    if (digitsOf(phoneInput.value).length !== expectedDigits()) invalid.push(phoneInput);
    return invalid;
  }

  /**
   * Is a consent row on screen?
   *
   * Read from the row's own `is-hidden` class rather than computed
   * visibility: the whole form is hidden whenever the card is showing
   * the provider buttons, so `offsetParent` would call every row hidden
   * and quietly satisfy the gate.
   */
  const isRowHidden = (box) =>
    Boolean(box.closest("li")?.classList.contains("is-hidden"));

  /**
   * The required boxes actually being asked for. Hiding a row in the
   * markup removes its requirement, and un-hiding restores it, with no
   * change here — see the note in index.html about what that means for
   * the consent timestamps the API still records.
   *
   * All three hidden leaves an empty list, and `every` on nothing is
   * true: there is nothing left to require, which is correct.
   */
  const activeRequiredConsents = () => requiredConsents.filter((box) => !isRowHidden(box));

  const consentsGiven = () => activeRequiredConsents().every((box) => box.checked);

  const canSubmit = () => invalidFields().length === 0 && consentsGiven();

  /** Gate Continue. Called on every keystroke, tick and country change. */
  function refreshSubmitState() {
    registerSubmit.disabled = !canSubmit();
  }

  /**
   * Mark the fields that are wrong. Only ever called from submit — a
   * half-typed number is not an error while it is still being typed.
   */
  function markInvalid(fields) {
    registerForm.querySelectorAll(".auth-card__field--invalid")
      .forEach((field) => field.classList.remove("auth-card__field--invalid"));
    fields.forEach((input) => {
      input.closest(".auth-card__field")?.classList.add("auth-card__field--invalid");
    });
    fields[0]?.focus();
  }

  if (registerForm) {
    // Live gating, so Continue lights up the moment the form is good.
    ["input", "change"].forEach((event) => {
      registerForm.addEventListener(event, refreshSubmitState);
    });

    // A different country means a different digit count, so what was a
    // valid number a moment ago may not be one now.
    countrySelect.addEventListener("change", refreshSubmitState);

    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setVisible(registerError, false);

      const invalid = invalidFields();
      if (invalid.length || !consentsGiven()) {
        // The button is disabled in this state, so this is the keyboard
        // path (Enter in a field). Say which field, don't just refuse.
        if (invalid.length) markInvalid(invalid);
        refreshSubmitState();
        return;
      }

      if (!pendingUser) {
        // The session went away under the form — sign in again.
        showError(registerError, "Your sign-in expired. Please sign in again.");
        renderMode(MODE.SIGNIN);
        return;
      }

      registerSubmit.disabled = true;
      registerSubmit.textContent = SUBMIT_BUSY_LABEL;

      try {
        const country = selectedCountry();

        const profile = await createParentProfile(pendingUser, {
          name: nameInput.value.trim(),
          email: pendingUser.email || "",
          // Dial code and local digits joined with nothing between
          // them, which is the E.164 string the app posts and the
          // backend stores — "+919876543210".
          phone: `${country.dataset.dial}${digitsOf(phoneInput.value)}`,
          countryRegion: country.value,
          language: languageSelect.value,
          marketingOptIn: byId("consentMarketing").checked,
        }, { hasExistingRow });

        // The required boxes are not sent as flags: the API records
        // consent as the timestamps `consent_accepted_at` /
        // `privacy_policy_accepted_at` / `terms_accepted_at`, which
        // `core/parent-directory.js` stamps. When those rows are shown,
        // Continue cannot be reached without them, so submitting *is*
        // the consent. While they are hidden the timestamps still go
        // out — see the note in index.html.

        completeSignIn(profile);
      } catch (error) {
        console.error("Creating the parent account failed:", error);
        showError(registerError, error?.status === 400 && error.message
          ? error.message
          : REGISTER_FAILED_COPY);
      } finally {
        registerSubmit.textContent = SUBMIT_IDLE_LABEL;
        refreshSubmitState();
      }
    });

    // "Not your account? Use a different one" — the parent pressed the
    // wrong Google account. Drop the session so the chooser reappears.
    registerCancel.addEventListener("click", async () => {
      pendingUser = null;
      awaitingRegistration = false;
      hasExistingRow = false;
      clearBanners();
      renderMode(MODE.SIGNIN);
      try {
        await signOutOfFirebase();
      } catch (error) {
        console.error("Could not drop the half-finished session:", error);
      }
    });
  }

  /**
   * "en" -> "English", for the account modal.
   *
   * Read off the form's own <option> list rather than a second table in
   * here, so the code/label pairing has exactly one home. A code the
   * form does not offer — the app has more languages than this page, or
   * will — is shown as it came rather than dropped.
   */
  function languageLabel(code) {
    if (!code) return "";
    const option = languageSelect?.querySelector(`option[value="${CSS.escape(code)}"]`);
    return option ? option.textContent.trim() : code;
  }

  /* ==========================================================
     The one funnel: what to do with a Firebase user
     ========================================================== */

  /** Registered and done: cache the details, close the card, move on. */
  function completeSignIn(profile) {
    // Read before the session is cleared: a profile the backend stored
    // without an email still has one on the Firebase user.
    const fallbackEmail = pendingUser?.email || "";

    pendingUser = null;
    awaitingRegistration = false;
    hasExistingRow = false;

    signIn({
      name: profile.name || DEFAULT_PARENT_NAME,
      email: profile.email || fallbackEmail,
      phone: profile.phone,
      language: languageLabel(profile.language),
    });

    // Having an account *is* step 2 — carry the parent straight on.
    if (appState.onboardingStep === 2) advanceToStep(STEP_AFTER_ACCOUNT);

    clearBanners();
    closeModal(authModal);
    onSignIn?.();
  }

  /**
   * No Cheeko account for this Google address. Say so, and put the
   * registration form up with everything we already know filled in.
   *
   * `paint` is false when the answer arrived during page load, with no
   * card on screen: popping a modal at someone who only reloaded is
   * rude. The pending session is remembered instead, and the header's
   * Sign in button walks straight back into this form.
   */
  function beginRegistration(user, { paint, partialProfile = null }) {
    pendingUser = user;
    awaitingRegistration = true;
    hasExistingRow = Boolean(partialProfile);

    registerEmail.textContent = partialProfile?.email || user.email || "";

    // Prefill only on the way in — re-opening the card after it was
    // dismissed must keep whatever the parent had already typed.
    //
    // Anything the half-filled row does carry is worth more than a
    // guess, so it wins; otherwise it is the same fallback chain as the
    // app's registration screen — the provider's display name, else the
    // local part of the address, which is usually close enough to be
    // worth correcting rather than typing.
    if (!nameInput.value) {
      nameInput.value = partialProfile?.name
        || user.displayName
        || (user.email || "").split("@")[0]
        || "";
    }
    if (!phoneInput.value && partialProfile?.phone) {
      prefillPhone(partialProfile.phone);
    }
    if (partialProfile?.language) {
      selectIfOffered(languageSelect, partialProfile.language);
    }
    if (partialProfile?.countryRegion) {
      selectIfOffered(countrySelect, partialProfile.countryRegion);
    }
    refreshSubmitState();

    if (!paint) return;

    clearBanners();
    notice.textContent = noticeFor(user, partialProfile);
    setVisible(notice, true);
    renderMode(MODE.REGISTER);
  }

  /**
   * What to tell the parent about why they are on this form.
   *
   * A half-filled row is a different situation from no account at all,
   * and saying "we could not find an account" to someone who has one
   * would be wrong as well as confusing.
   */
  function noticeFor(user, partialProfile) {
    const address = partialProfile?.email || user.email;

    if (partialProfile) {
      return "Your Cheeko account is missing a few details. Please finish "
        + "setting it up.";
    }

    return address
      ? `We could not find a Cheeko account for ${address}. Let's create one.`
      : "We could not find a Cheeko account for that address. Let's create one.";
  }

  /** Pick `value` only if the select offers it, so nothing is blanked. */
  function selectIfOffered(select, value) {
    const option = select?.querySelector(`option[value="${CSS.escape(value)}"]`);
    if (option) select.value = value;
  }

  /**
   * Split a stored E.164 number back into the country and the local
   * digits the two fields hold — "+919812345678" is one string on the
   * wire and two controls here.
   *
   * Longest dial code first, so +1 does not claim a +91 number.
   */
  function prefillPhone(stored) {
    const options = Array.from(countrySelect.options)
      .sort((a, b) => (b.dataset.dial?.length || 0) - (a.dataset.dial?.length || 0));

    const match = options.find((option) => stored.startsWith(option.dataset.dial));
    if (match) {
      countrySelect.value = match.value;
      phoneInput.value = digitsOf(stored.slice(match.dataset.dial.length));
      return;
    }

    // An unrecognised country: keep the digits so nothing is lost, and
    // leave the parent to pick the code.
    phoneInput.value = digitsOf(stored);
  }

  /**
   * The lookup itself failed, so we know nothing. Hold the session and
   * make the parent's next press retry, rather than guessing.
   */
  function handleLookupFailure(user, error, { paint }) {
    console.error("Could not look up the parent profile:", error);
    pendingUser = user;
    awaitingRegistration = false;
    // Nothing was learned, so nothing may be assumed about the row.
    hasExistingRow = false;
    if (paint) showError(errorBanner, LOOKUP_FAILED_COPY);
  }

  /**
   * Ask the directory about `user`, then take one of the paths.
   *
   * The lookup has three outcomes, but a found profile splits in two.
   * A row can exist with no name and no phone number — the backend
   * creates one that way if a POST arrives without them — and that is
   * an account nobody ever filled in, not a returning parent. The app
   * draws the same line (`ParentProfile.isProfileComplete`) and routes
   * such a parent back to its setup screen, so this page does too
   * rather than showing an account modal with a blank phone number.
   */
  async function resolveUser(user) {
    const paint = isModalOpen(authModal);

    try {
      const profile = await fetchParentProfile(user);

      if (profile && isProfileComplete(profile)) {
        completeSignIn(profile);
      } else {
        // `profile` non-null here means the row exists but is empty, so
        // finishing it is an update, not a create. Carried through to
        // the submit handler, which would otherwise POST onto a row
        // that already exists and dead-end exactly as the app does.
        beginRegistration(user, { paint, partialProfile: profile });
      }
    } catch (error) {
      handleLookupFailure(user, error, { paint });
    } finally {
      setProvidersBusy(false);
    }
  }

  watchAuthState((user) => {
    if (user) {
      resolveUser(user);
      return;
    }

    pendingUser = null;
    awaitingRegistration = false;
    hasExistingRow = false;
    setProvidersBusy(false);

    if (appState.isLoggedIn) {
      // Firebase says no session, so a stale local one must not survive.
      signOut();
      onSignOut?.();
    }
  }).catch((error) => {
    console.error("Firebase Auth could not load — sign-in is unavailable:", error);
    showError(errorBanner, LOOKUP_FAILED_COPY);
  });

  /* ==========================================================
     Opening the card
     ========================================================== */

  /**
   * Open the auth card in the right state, which is not always the mode
   * asked for: a parent who is midway through registering belongs back
   * on their form, and one whose lookup failed wants it retried rather
   * than a fresh Google round-trip.
   */
  function openAuthModal(nextMode = MODE.SIGNIN) {
    if (pendingUser && awaitingRegistration) {
      renderMode(MODE.REGISTER);
      openModal(authModal);
      return;
    }

    if (pendingUser) {
      renderMode(MODE.SIGNIN);
      clearBanners();
      setProvidersBusy(true);
      openModal(authModal);
      resolveUser(pendingUser);
      return;
    }

    clearBanners();
    renderMode(nextMode);
    openModal(authModal);
  }

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
