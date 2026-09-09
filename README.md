# Cheeko — Setup & Onboarding page

The `index.html` page of cheekoai.in: a five-step device setup wizard, a
parent dashboard, and the support/documentation section.

Previously this was a single 1,447-line `start-minimal.html` with the CSS,
the JavaScript and a base64-encoded logo all inlined. It is now split into
a conventional static-site structure.

## Structure

```
.
├── index.html                    the page (markup only)
├── README.md
└── assets/
    ├── img/
    │   ├── cheeko-logo.png       was a 37 KB base64 data URI in the markup
    │   ├── auth-fox-*.png       the two sign in / sign up mascot poses,
    │   │                        split out of `login illust.png`
    │   └── screens/              Parent App screenshots (see its README)
    ├── css/
    │   ├── main.css              the only stylesheet the page links
    │   ├── base/                 tokens, reset, typography, utilities
    │   ├── layout/               page shell: header, footer, ticker
    │   ├── components/           reusable blocks (button, modal, tabs, …)
    │   └── pages/                view-specific composition
    └── js/
        ├── main.js               entry point (ES module)
        ├── core/                 storage, persisted state, DOM helpers
        ├── components/           reusable UI behaviour
        └── features/             this page's screens
```

### CSS

`main.css` is the single entry point; everything else arrives through
`@import`, and **import order is cascade order**:

| Layer | Contains | May override |
|---|---|---|
| `base/` | tokens, reset, type scale, `is-*` utilities | — |
| `layout/` | container, header, footer, ticker | base |
| `components/` | auth-card, button, form, panel, phone, modal, tabs, accordion, switch, store-badges, lists, media, screen-showcase, segmented | base, layout |
| `pages/` | onboarding, dashboard, support | everything above |

Media queries sit next to the rules they modify, mobile-first
(`min-width` only). Breakpoints: **600px** tablet, **900px** desktop.

### Showing the app's own screens

Steps 2, 3 and 4 each carry a **screen showcase**: a numbered blurb beside a
screenshot of the Parent App screen that step is talking about. Two
components make it:

- `components/phone.css` — a CSS-only iPhone shell for *unframed* exports:
  bezel, dynamic island and side buttons drawn in CSS, width from
  `--phone-width`. The current screenshots ship with their own frame, so
  nothing uses it today; it is kept for the next export that arrives raw.
- `components/screen-showcase.css` — the copy/device pair. It stacks on
  mobile and splits into two columns at 600px; `screen-showcase--reverse`
  puts the phone on the left so a run of them zig-zags down the page.

Screenshots live in `assets/img/screens/`, which has its own README naming
the three files, how they are prepared, and what to do with an export that
does not already carry a device frame.

### JavaScript

ES modules, one concern per file. Each exports a single `initX()` that
wires its own DOM and returns a small handle for anything the rest of the
page needs (`{ reset }`, `{ activateTab }`, …). `main.js` is the only file
that knows about more than one feature.

| File | Responsibility |
|---|---|
| `core/config.js` | deployment settings — Web3Forms key, Firebase project |
| `core/firebase.js` | Firebase Auth, loaded from the CDN on first use |
| `core/storage.js` | `localStorage` with an in-memory fallback for Safari with cookies blocked |
| `core/app-state.js` | all persisted state + setters + change subscription |
| `core/dom.js` | `qs` / `qsa` / `byId` / `setVisible` |
| `components/modal.js` | open, close, backdrop, Escape, scroll lock |
| `components/info-tabs.js` | support tab strip |
| `components/faq-accordion.js` | single-open FAQ |
| `components/video-modal.js` | simulated tutorial player |
| `features/onboarding-wizard.js` | the five-step slider and progress rail |
| `features/parent-auth.js` | sign in / sign up card via Google, log out |
| `features/parent-dashboard.js` | safety controls, resource shortcuts |
| `features/support-forms.js` | warranty (demo) + support ticket form (sends email) |

## Naming conventions

**CSS classes — BEM.** `.block`, `.block__element`, `.block--modifier`.
A block never styles another block's internals; shared looks are their
own component (`.button`, `.panel`).

**State classes.** Toggled by JavaScript, never authored by hand:
`is-hidden`, `is-modal-open`, or a BEM modifier such as `.modal--open`.
`is-hidden` exists so JS never has to hard-code `display: flex` vs
`block` — each component keeps the display its stylesheet gave it.

**JS hooks are `data-*` attributes, not classes.** `data-wizard-next`,
`data-video`, `data-tab`, `data-action`, `data-modal-close`,
`data-success-message`. Renaming a style class can never break behaviour.

**IDs** are `camelCase` and used only where JS needs one specific element
or a `<label for>` needs a target.

**Custom properties are semantic**, not literal: `--color-brand`,
`--space-gutter`, `--radius-lg`, `--shadow-sm`. Values are unchanged from
the live site's `premium.css`; only the names were made readable.

**Files** are `kebab-case`. **JS** uses `camelCase` for functions and
variables, `SCREAMING_SNAKE_CASE` for module constants.

## Running locally

`assets/js/main.js` is an ES module, so browsers will not load it over
`file://`. Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Notes

- The **Download the Parent App** step (step 1) links to the live stores:
  [App Store](https://apps.apple.com/in/app/cheekoai/id6748904798) ·
  [Google Play](https://play.google.com/store/apps/details?id=com.cheekoai.in)
- The warranty form is a **front-end simulation**. Nothing is sent
  anywhere; wizard progress is remembered in `localStorage` only.

## Sign in / Sign up (Firebase)

Google sign-in runs on Firebase Auth, project **cheekoai**. The SDK
(v12.18.0) is imported from Google's CDN inside
[`core/firebase.js`](assets/js/core/firebase.js) on first use — a
dynamic import, so if the CDN is unreachable only sign-in breaks and the
rest of the page keeps working.

Firebase is the source of truth for who is signed in. The button just
opens Google's chooser; app state, closing the card and the onboarding
step all hang off the `onAuthStateChanged` listener, so a session
restored on page load takes the same path as a fresh sign-in.

### Console setup

Already done on this project, verified against the Identity Toolkit API:

- Authentication is provisioned.
- The **Google** sign-in provider is enabled.

**The one thing left is the authorised-domain list.** The popup only
runs on a domain Firebase knows about; anywhere else fails with
`auth/unauthorized-domain`. As of writing the list is:

```
localhost
127.0.0.1
cheekoai.firebaseapp.com
cheekoai.web.app
cheekoai-parent-app.vercel.app
```

Nothing on that list serves this page. Add, under Firebase Console →
Authentication → Settings → Authorised domains:

```
www.cheekoai.in     <- the one that matters
cheekoai.in         <- insurance if the redirect ever flips
```

`www` is the important one: the apex 307-redirects to `www.cheekoai.in`,
and Firebase checks the host in the address bar *after* redirects.
Matching is exact — `cheekoai.in` does not cover its own `www`.

If this page ends up on its own Vercel project or a subdomain, add that
exact host too. Wildcards are not supported, so Vercel's per-deploy
preview URLs (`project-a1b2c3-team.vercel.app`) cannot be authorised
ahead of time; branch aliases (`project-git-main-team.vercel.app`) are
stable and can.

### Analytics

`measurementId` is in the config but Analytics is **not** initialised —
nothing calls `getAnalytics()`. Turning it on means tracking cookies on
a site aimed at parents of young children, which is a consent decision
rather than a code one, so it was left off deliberately. To enable it,
import `firebase-analytics.js` alongside the auth SDK in
[`core/firebase.js`](assets/js/core/firebase.js).

### Sign in vs Sign up

With Google there is only one flow. The two modes differ in wording
only: signing in with an unknown Google account creates it, and signing
up with a known one just signs in. Splitting them for real means
checking `getAdditionalUserInfo(credential).isNewUser` and rejecting the
mismatch — worth doing only if you want to turn people away.

### What is not stored

Nothing is written to Firestore — there is no database in this project
yet. The parent's name and email live in `localStorage` for the greeting
and the account modal, and the "Paired Devices" and subscription lines
in that modal are still hardcoded markup.

## Contact Support email

The Contact Support form really sends. It POSTs to
[Web3Forms](https://web3forms.com), which relays the message to
**hello@altio.me** — the site is static, so it has no way to send mail
itself.

**Setup (once):** go to web3forms.com, enter `hello@altio.me`, and they
email back an access key. Paste it into `WEB3FORMS_ACCESS_KEY` in
[`assets/js/core/config.js`](assets/js/core/config.js). The key is
submit-only — it can post to that one inbox and nothing else — so it is
safe to commit and safe in page source.

Until the key is filled in the form shows its error banner and logs the
reason to the console. It never shows the success banner for a message
that did not go out.

Replies work off `replyto`, so hitting reply in the inbox answers the
parent rather than the relay.

### Ticket IDs

Each sent request is stamped with a four-digit ticket such as `#CK-4821`.
The same number goes three places: the banner the parent sees, a
`Ticket ID` row in the email, and the email's subject line, so a reply
can be matched to a request by searching the inbox.

It is minted in the browser just before sending, and thrown away if the
send fails — the banner can never quote a ticket for a message that did
not go out.

**It is a reference, not a key.** Four digits is 9,000 possible tickets
drawn at random with nothing checking against previous ones, so by the
birthday bound two parents share a number around the 110th ticket, and
it is roughly even odds by ~150. That is fine for quoting in a reply and
wrong for indexing on. Making it genuinely unique needs somewhere to
record issued numbers — a backend — or more digits.

**Making another form live:** give it `data-email-subject` (the email's
subject line) and `data-error-message` (the id of its error banner).
Fields are read by their `name` attribute, so every control that should
appear in the email needs one. Without `data-email-subject` a form stays
a demo, which is what the warranty form still is.
