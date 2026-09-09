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
 * Open the Google account chooser. Resolves with the signed-in user;
 * rejects with a Firebase error whose `.code` the caller can read.
 */
export async function signInWithGoogle() {
  const { auth, authSdk } = await loadAuth();

  const provider = new authSdk.GoogleAuthProvider();
  // Always offer the chooser — parents share devices with each other.
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await authSdk.signInWithPopup(auth, provider);
  return credential.user;
}

export async function signOutOfFirebase() {
  const { auth, authSdk } = await loadAuth();
  return authSdk.signOut(auth);
}

/**
 * Call `listener` with the current user (or null) once Firebase has
 * restored any saved session, and again on every change.
 */
export async function watchAuthState(listener) {
  const { auth, authSdk } = await loadAuth();
  return authSdk.onAuthStateChanged(auth, listener);
}
