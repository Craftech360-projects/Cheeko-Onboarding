/**
 * core/config.js
 * Deployment settings that are not code — the things you change when
 * the site moves, not when the page changes.
 */

/**
 * Relays the Contact Support form to the Cheeko support inbox
 * (hello@altio.me).
 *
 * To get the key: go to https://web3forms.com, enter hello@altio.me,
 * and the key arrives by email. Paste it below.
 *
 * The key is submit-only — it can post a form to that one inbox and do
 * nothing else — so it is safe to commit and safe in the page source.
 * While it is empty the support form reports a send failure instead of
 * pretending the message went out.
 */
export const WEB3FORMS_ACCESS_KEY = "6d139e75-5158-4930-a39f-cd4e1f11b2f5";

/**
 * Firebase project that backs Sign in / Sign up — project "cheekoai".
 *
 * These values are public by design — they ship inside every Firebase
 * web app and identify the project rather than authorise anything. What
 * actually guards the project is the Authorised domains list in
 * Firebase Console → Authentication → Settings, plus security rules on
 * any database you add later. See the README before deploying to a new
 * domain.
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAFczFaHCYnHlVTjFe73J-4QrYfevvm1Sw",
  authDomain: "cheekoai.firebaseapp.com",
  projectId: "cheekoai",
  storageBucket: "cheekoai.firebasestorage.app",
  messagingSenderId: "956241760367",
  appId: "1:956241760367:web:15b942c8aebbe2f1293d9a",
  // Only used if Analytics is switched on — see the README.
  measurementId: "G-D5C9BEC9WS",
};
