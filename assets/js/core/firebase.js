/**
 * core/firebase.js
 * Firebase Authentication, wrapped so the rest of the page never sees
 * the SDK directly.
 *
 * The SDK is imported dynamically from Google's CDN on first use. That
 * is deliberate: if the CDN is unreachable the import rejects here and
 * only sign-in breaks — the wizard, tabs and support form keep working,
 * which a top-level import would not allow.
 */

import { FIREBASE_CONFIG } from "./config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.18.0";

let sdkPromise = null;

/** Load and initialise the SDK once; every caller shares the promise. */
function loadAuth() {
  if (!sdkPromise) {
    // An ungenerated env.js leaves the config blank, and Firebase's own
    // error for that is opaque. Fail here with the fix instead.
    if (!FIREBASE_CONFIG.apiKey) {
      sdkPromise = Promise.reject(new Error(
        "Firebase is not configured — assets/js/core/env.js has no "
        + "FIREBASE_API_KEY. Run `node tools/build-env.mjs`.",
      ));
      return sdkPromise;
    }

    sdkPromise = Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
    ]).then(([appSdk, authSdk]) => {
      const app = appSdk.initializeApp(FIREBASE_CONFIG);
      return { auth: authSdk.getAuth(app), authSdk };
    });
  }
  return sdkPromise;
}

/**
 * Build the provider for one of the buttons on the auth card.
 * Google has a dedicated class; Apple goes through the generic OAuth
 * one, and needs its scopes asked for by name.
 */
function buildProvider(authSdk, name) {
  if (name === "google") {
    const provider = new authSdk.GoogleAuthProvider();
    // Always offer the chooser — parents share devices with each other.
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  if (name === "apple") {
    const provider = new authSdk.OAuthProvider("apple.com");
    // Apple withholds both unless asked, and sends the name only on the
    // very first sign-in.
    provider.addScope("email");
    provider.addScope("name");
    return provider;
  }

  throw new Error(`Unknown sign-in provider: ${name}`);
}

/**
 * Open the provider's sign-in window. Resolves with the signed-in user;
 * rejects with a Firebase error whose `.code` the caller can read.
 */
export async function signInWith(name) {
  const { auth, authSdk } = await loadAuth();
  const credential = await authSdk.signInWithPopup(auth, buildProvider(authSdk, name));
  return credential.user;
}

export async function signOutOfFirebase() {
  const { auth, authSdk } = await loadAuth();
  return authSdk.signOut(auth);
}

/**
 * A Firebase ID token for the signed-in parent, or null if there is no
 * session.
 *
 * This is what the parent-profile API authenticates with: a signed JWT
 * the backend verifies with the Firebase Admin SDK, so the browser
 * never has to be trusted about who it is. Firebase caches and renews
 * it behind this call, so ask for one per request rather than holding
 * on to it.
 *
 * `forceRefresh` skips that cache. The Parent App does the same on a
 * 401 (see ProfileApiService._sendWithFreshTokenRetry): a token that
 * expired in the seconds between being minted and being read comes
 * back from the cache still stale, and only a forced refresh clears
 * it.
 */
export async function getIdToken({ forceRefresh = false } = {}) {
  const { auth } = await loadAuth();
  return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
}

/**
 * Call `listener` with the current user (or null) once Firebase has
 * restored any saved session, and again on every change.
 */
export async function watchAuthState(listener) {
  const { auth, authSdk } = await loadAuth();
  return authSdk.onAuthStateChanged(auth, listener);
}
