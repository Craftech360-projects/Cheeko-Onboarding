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
├── .env.example                  settings template — copy to .env
├── package.json                  scripts only; the page has no build step
├── tools/
│   └── build-env.mjs             .env -> assets/js/core/env.js
├── tests/                        browser tests — see tests/README.md
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
        ├── core/                 settings, storage, state, DOM, backend
        ├── components/           reusable UI behaviour
        └── features/             this page's screens
```

### CSS

`main.css` is the single entry point; everything else arrives through
`@import`, and **import order is cascade order**:

| Layer | Contains | May override |
|---|---|---|
| `base/` | tokens, reset, type scale, `is-*` utilities, shared entrance keyframes | — |
| `layout/` | container, header, footer, ticker | base |
| `components/` | auth-card, button, form, panel, phone, modal, tabs, accordion, switch, store-badges, lists, media, screen-showcase, segmented | base, layout |
| `pages/` | onboarding, dashboard, device-info, support | everything above |

Media queries sit next to the rules they modify, mobile-first
(`min-width` only). Breakpoints: **600px** tablet, **900px** desktop.

### Showing the app's own screens

Steps 2, 3 and 4 each carry a **screen showcase**: a numbered title and a few
short points beside a screenshot of the Parent App screen that step is talking about. Two
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
| `core/config.js` | reads `core/env.js` and hands out plain constants |
| `core/env.js` | **generated** from `.env`, gitignored — see [Settings](#settings-and-env) |
| `core/api-environment.js` | which of the three backends this page talks to, and why |
| `core/firebase.js` | Firebase Auth, loaded from the CDN on first use |
| `core/parent-directory.js` | the parent-profile API — does this parent have an account? |
| `core/storage.js` | `localStorage` with an in-memory fallback for Safari with cookies blocked |
| `core/app-state.js` | all persisted state + setters + change subscription |
| `core/dom.js` | `qs` / `qsa` / `byId` / `setVisible` |
| `components/modal.js` | open, close, backdrop, Escape, scroll lock |
| `components/info-tabs.js` | support tab strip |
| `components/faq-accordion.js` | single-open FAQ |
| `components/video-modal.js` | simulated tutorial player |
| `features/onboarding-wizard.js` | the five-step slider and progress rail; Finish's confirmation and its jump to Device Info |
| `features/parent-auth.js` | sign in / sign up / register card, log out |
| `features/parent-dashboard.js` | safety controls, resource shortcuts |
| `features/device-info.js` | every toy on the signed-in account — details and warranty — from the backend |
| `features/support-forms.js` | support ticket form (sends email) |

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

First time only — create your settings file:

```bash
cp .env.example .env      # then fill in the values, see Settings below
```

`assets/js/main.js` is an ES module, so browsers will not load it over
`file://`. Serve the folder — **on port 3000**, not 8000:

```bash
npm run serve             # regenerates env.js, then serves on port 3000
# then open http://localhost:3000/
```

`npm run serve` runs `npm run env` first, so `assets/js/core/env.js` is
regenerated from `.env` every time. That is deliberate: it is a
generated, gitignored file the page hard-depends on, and both ways of
getting it wrong are unpleasant. **Missing** — a fresh clone, a
`git clean`, a deploy that skips the generator — and sign-in throws
`Firebase is not configured`. **Stale** — `.env` edited without
re-running it — and the page silently talks to the wrong backend, which
is worse than an error. `npm test` regenerates it too, via `pretest`.

If you serve the folder some other way (VS Code Live Server, plain
`python3 -m http.server`), run `npm run env` yourself after touching
`.env`.

**Deploying:** `node tools/build-env.mjs` has to run in the build step,
with the `CHEEKO_PUBLIC_*` values present in the host's environment.
Without it the deployed page has no `env.js` and sign-in is dead.

The port is not arbitrary. Sign-in reads the parent-profile API, and
that API answers a browser only from an origin on its CORS allowlist —
`http://localhost:3000` and `http://localhost:8080` are on it,
`http://localhost:8000` is not. On 8000 every profile lookup fails with
an opaque `TypeError: Failed to fetch` and the card reports that it
could not check your account. See [CORS](#cors--the-one-thing-still-to-do).

## Tests

```bash
npm install && npx playwright install chromium   # once
npm run serve                                    # in another shell
npm test
```

They drive the real page in a real browser, stubbing only
`core/firebase.js` (Google's popup is the one thing that cannot be
automated) so `parent-auth.js`, `parent-directory.js` and
`app-state.js` run as shipped. `npm run test:cors` answers separately
whether a browser on a given origin can reach the live API.

See [`tests/README.md`](tests/README.md) for what each file covers and
why the assertions are what they are.

`npm` is only ever needed for these and for `npm run env`. The page
itself has no build step and no runtime dependencies.

## Notes

- The **Download the Parent App** step (step 1) links to the live stores:
  [App Store](https://apps.apple.com/in/app/cheekoai/id6748904798) ·
  [Google Play](https://play.google.com/store/apps/details?id=com.cheekoai.in)
- Wizard progress is remembered in `localStorage` only.
- The **Device Info** section, warranty included, is read from the
  backend, not entered — see [Device info](#device-info).

## Settings and `.env`

Every deployment setting lives in `.env`, which is **not committed**.
`.env.example` is the committed template.

```bash
cp .env.example .env       # fill in the values
node tools/build-env.mjs   # writes assets/js/core/env.js
```

Re-run the generator after every edit to `.env`, and as part of
deploying. `core/config.js` imports the generated module and hands the
rest of the page plain constants, so no other file knows where a setting
came from.

### A browser has no secrets

This is the important part. Everything the generator writes into
`env.js` is served with the page and readable by anyone who opens it —
"in a `.env` file" is not the same as "secret" once it reaches a
browser.

So `tools/build-env.mjs` is an **allowlist, not a copier**: it publishes
only keys named `CHEEKO_PUBLIC_*` and reports every other key as
skipped. That lets one `.env` hold both browser settings and backend
secrets without a rename or a typo ever publishing one. A service
account key, a database URL, an API secret — those stay unprefixed, and
never reach `env.js`.

The four public settings are public *by design*, which is why they were
safe to commit before this change and are safe in page source now:

| Key | Why it is safe to expose |
|---|---|
| `CHEEKO_PUBLIC_WEB3FORMS_ACCESS_KEY` | submit-only; it can post to one inbox and nothing else |
| `CHEEKO_PUBLIC_FIREBASE_*` | ships inside every Firebase web app; identifies the project rather than authorising anything — what guards it is the authorised-domain list and your security rules |
| `CHEEKO_PUBLIC_API_BASE_URL_*`, `CHEEKO_PUBLIC_API_ENV` | hostnames and a name; the API authenticates every request with a Firebase ID token |

Note that these values are still in this repo's **git history** from
before they moved to `.env`. That is not a leak — see the table — but if
you ever put something genuinely secret in a `CHEEKO_PUBLIC_` key, the
history is where it will stay.

If `env.js` is missing, `core/config.js` says so in the console —
naming the command that fixes it — and falls back to empty values, so
sign-in and the support form switch off while the rest of the page keeps
working. `npm run serve` and `npm test` regenerate it, so the only way
to hit that is serving the folder some other way, or a deploy whose
build step skips the generator.

## Accounts — sign in, sign up, register

Google sign-in runs on Firebase Auth, project **cheekoai**. The SDK
(v12.18.0) is imported from Google's CDN inside
[`core/firebase.js`](assets/js/core/firebase.js) on first use — a
dynamic import, so if the CDN is unreachable only sign-in breaks and the
rest of the page keeps working.

Firebase is the source of truth for **who** is signed in; the
parent-profile API is the source of truth for **whether they have an
account**. The next two sections are about why that difference matters.

The provider buttons only open Google's chooser. Everything after
that — the profile lookup, the branch, app state, closing the card, the
onboarding step — hangs off the `onAuthStateChanged` listener, so a
session restored on page load takes exactly the same path as a fresh
sign-in. One funnel, one set of bugs.

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

### Apple sign-in — not live yet

The button is built and wired, but the provider is **not configured**;
the Identity Toolkit API currently answers `OPERATION_NOT_ALLOWED: Code
flow is not enabled for Apple`, so pressing it fails until the steps
below are done.

Unlike Google, this needs a **paid Apple Developer Program membership**
(~$99/year). In the Apple developer portal:

1. An **App ID** with the *Sign in with Apple* capability.
2. A **Services ID** — this is the Client ID Firebase asks for. Under its
   *Sign in with Apple* config, register the domain the page is served
   from and set the Return URL to exactly:
   `https://cheekoai.firebaseapp.com/__/auth/handler`
3. A **Key** with *Sign in with Apple* enabled. Download the `.p8` file —
   Apple lets you download it once — and note the **Key ID**.
4. Note your **Team ID** from the membership page.

Then in Firebase Console → Authentication → Sign-in method → Apple:
enable it and paste the Services ID, Team ID, Key ID and the contents of
the `.p8`.

Two Apple behaviours worth designing around:

- **The name arrives once.** Apple sends the user's name only on the very
  first authorisation. On later sign-ins `displayName` is null, so
  `parent-auth.js` falls back to "Parent". Capture it on first sign-in if
  you ever need it stored.
- **Hide My Email.** Users may hand over a `@privaterelay.appleid.com`
  address instead of their real one. Mail to it only reaches them if the
  sending domain is registered in Apple's private email relay config.

### One account, two buttons

Firebase defaults to one account per email address. A parent who signs up
with Google and later presses Apple with the same address gets
`auth/account-exists-with-different-credential`, which the card reports
as "You already have an account with that email. Try the other button."
Linking the two credentials into one account is extra work that has not
been done.

### Two questions, not one

Google tells the page **who** someone is. It does not tell it whether
they have a **Cheeko account** — the popup happily mints a Firebase
record for an address nobody has seen before. So every sign-in asks a
second question, of [`core/parent-directory.js`](assets/js/core/parent-directory.js):
is there a parent profile for this uid?

| Answer | What the parent sees |
|---|---|
| profile found **and complete** | signed in, their saved details in the account modal |
| profile found but **empty** | "Your Cheeko account is missing a few details" → the form, prefilled from what the row does have |
| no profile (404) | "We could not find a Cheeko account for …" → the form |
| lookup failed | "We could not check your Cheeko account just now" — and nothing else happens |

"Complete" is the app's own rule, `ParentProfile.isProfileComplete`: a
name and a phone number, both non-empty. A 200 is not proof anyone ever
filled the form in — the backend stores `phone_number:
data.phoneNumber || ''`, so a row can exist with nothing in it. The app
routes such a parent back to its setup screen; showing them an account
modal with a blank phone number instead would be the bug.

Finishing an existing row is a **PUT**, not a POST, and the verb is
chosen from that lookup rather than guessed from whether a collision
comes back as 409 or 500. The PUT sends the app's
`updateParentProfile` field set exactly, and deliberately does *not*
invent consent columns on an update — the consent recorded when the row
was created still stands.

That third row is the one worth guarding. **"We could not ask" must
never be read as "you are new."** Collapsing the two walks a registered
parent into signing up for a second, empty account — the Parent App
shipped that bug and fixed it the same way, which is what the comments
on its `UserStateAvailability` and `decideSplashRoute` are about. So
`fetchParentProfile` resolves `null` only for a real 404 and throws for
everything else: a 401, a 5xx, a timeout, a gateway's HTML error page.

The lookup is also why `getAdditionalUserInfo(cred).isNewUser` is not
used. That flag describes the Firebase *auth record*, not the account: a
parent who signed in and abandoned the form has a record and no
profile, and `isNewUser` would call them a returning parent and let them
in with no name and no phone number.

### The same API as the Parent App

Registration reads and writes the **same parent record the phone app
does**, so it is one account either way: register on the phone and you
are a returning parent here; register here and the app finds you set up
when it opens.

An account is **two server-side rows**, and registering writes both:

| Row | Holds | Who reads it |
|---|---|---|
| `user-state` | account existence — `onboarding_completed`, `current_stage` | the Parent App's launch check, on **every** launch |
| `parent-profile` | the human details — name, phone, language, consent | both clients, to show the account |

```
GET  {base}/toy/api/mobile/parent-profile   200 -> the profile
                                            404 -> no account yet
POST {base}/toy/api/mobile/user-state       201/200/409 -> the row exists
POST {base}/toy/api/mobile/parent-profile   201 -> the profile it created
PUT  {base}/toy/api/mobile/parent-profile   200 -> a row filled in
```

**Order matters, and it is user-state first.** If the profile write
fails after that, the parent looks new to both clients and can simply
try again. The reverse — a profile row with no account row — is the
state that strands them: the app's launch check reads a 404 from
user-state, calls them brand new, and sends them to its profile setup
screen, which *always* POSTs (`// Create profile (new user — always
POST)`). That POST lands on the row this page already wrote and
dead-ends on an error popup with no way forward.

So a user-state failure aborts the whole registration rather than
carrying on. The server's `createUserState` is itself idempotent — it
returns an existing row instead of erroring — and 409 is treated as
success here for the same reason: the row existing is the state we were
asking for. A parent who abandons the form once will legitimately reach
this call again on their next visit.

`{base}` is whichever host [`core/api-environment.js`](assets/js/core/api-environment.js)
resolved — see [Choosing a backend](#choosing-a-backend). Every call
carries `Authorization: Bearer <Firebase ID token>`, which the backend
verifies with the Firebase Admin SDK, so the uid and email come from
the token and never from the body.

[`core/parent-directory.js`](assets/js/core/parent-directory.js) mirrors
the app's `lib/services/profile_api_service.dart` on purpose, because
divergence between the two clients shows up as data the other one
cannot read:

- **The POST body, field for field** — `parent_name`, `email`,
  `phone_number` (E.164, dial code included: `+919876543210`),
  `country_region` (ISO: `IN`), `preferred_language` (a code: `en`,
  `hi`, `kn`, `ml`), `timezone` (IANA, omitted when the browser will not
  say, so a stored good value is never overwritten with UTC),
  `consent_accepted_at` / `privacy_policy_accepted_at` /
  `terms_accepted_at` (one timestamp — they were all agreed to by the
  same click), `terms_version`, `marketing_opt_in`,
  `notification_preferences`.
- **`terms_version` is `2025-07-28`**, matching
  `LegalDocuments.termsVersion` in the app. Bump both together.
- **The 401 retry.** A rejected token is retried once with a
  force-refreshed one. This backend sometimes reports an expired token
  as a 200 whose *body* carries `code: 401`, so the body is checked as
  well as the status.
- **Timeouts** of 12s on the read and 15s on the write, matching the
  app's `kBackendRequestTimeout`. Unbounded, a backend that accepts the
  connection and never answers parks the card for minutes.

Do **not** point the base URL at the app's `MOBILE_API_BASE_URL`
(`http://103.214.61.55`). A browser on an `https://` page refuses
plain-HTTP requests as mixed content, so it can never work here.

### Choosing a backend

Three hosts, mirroring the Parent App's `api_config_service.dart`, and
one selector — all in `.env`:

```
CHEEKO_PUBLIC_API_BASE_URL_PRODUCTION=https://ota.cheekoai.in
CHEEKO_PUBLIC_API_BASE_URL_DEVELOPMENT=https://otadev.cheekoai.in
CHEEKO_PUBLIC_API_BASE_URL_LOCAL=http://localhost:8002
CHEEKO_PUBLIC_API_ENV=development
```

`CHEEKO_PUBLIC_API_ENV` takes `production`, `development` or `local`.
The committed default is **development**, not production.

Precedence, highest first:

1. `?api=…` in the URL — `production`, `development`, `local`,
   `standin`, or `clear` to forget it. `prod` and `dev` work as
   aliases.
2. `localStorage`, from a previous `?api=…`. It is remembered on
   purpose: the point is to test a deployed build against another
   backend, and that means clicking through pages that will not carry
   the parameter.
3. `CHEEKO_PUBLIC_API_ENV`.
4. Nothing — the localStorage stand-in.

The page logs which one it picked and where that came from on every
load, so "which backend am I on?" is never a guess.

**Empty is a supported state, not a bug.** An empty `API_ENV`, an empty
URL for the selected environment, or `?api=standin` all switch on the
stand-in described [below](#running-with-no-backend). That is the only
way to work when no backend is reachable, which — see the next
section — is currently the case for most origins.

The fallback is deliberately the stand-in and **not** production. The
app falls back to production when nothing is set; copying that here
would be a trap, because a browser sent to a host whose allowlist does
not name it fails with an opaque `TypeError: Failed to fetch`. Someone
who checks out this repo and runs it should get a page that works.

Two things worth knowing:

- `local` is plain http. An **https** page cannot call it — browsers
  block that as mixed content before the request is sent — so
  `api-environment.js` logs an error naming that specifically. Serve
  the page over http for local work. The same trap is why the app's own
  `MOBILE_API_BASE_URL` (`http://103.214.61.55`) can never be used
  here.
- A local backend must allow `http://localhost:3000` as a CORS origin
  too. Being on the same machine does not make it the same origin.

### CORS — the one thing still to do

The Parent App is native, so CORS never applied to it. A browser is
different: it will not let this page read the API's reply unless the
API's preflight names this page's origin. This is a server-side
allowlist on each host — nothing in this repo can change it.

Measured from a real browser (`npm run test:cors`, which is the only
way to measure it — curl ignores CORS, so a blocked host looks
perfectly healthy from the shell):

| from | production | development | local |
|---|---|---|---|
| `http://localhost:3000` | **reachable** | blocked | *(nothing listening)* |
| `http://localhost:8080` | **reachable** | blocked | *(nothing listening)* |
| `https://www.cheekoai.in` | blocked | blocked | n/a |

Two things fall out of that, and both are worth knowing before
debugging anything:

- **`otadev.cheekoai.in` allows no browser origin at all.** It answers
  curl (401, so it is up and healthy) and refuses every browser. So the
  committed default of `development` cannot currently talk to anything
  from a browser, and falls through to the console diagnostic below.
  Adding `http://localhost:3000` to dev's allowlist is the single change
  that makes local verification work against dev.
- **Production is reachable from `localhost:3000`**, which makes
  `?api=production` a working escape hatch today. It is *not* reachable
  from `https://www.cheekoai.in`, so production still needs its own
  allowlist entry before this page works on the live domain.

To fix, server-side, alongside the `Authorization` header (already
allowed on both hosts):

```
https://www.cheekoai.in     <- the live page
https://cheekoai.in         <- insurance if the redirect ever flips
http://localhost:3000       <- local development (dev host especially)
```

### Why a blocked request is not a confusing one

A refused preflight is reported to JavaScript as a bare
`TypeError: Failed to fetch` — no status, no body, byte for byte what a
dead server looks like. The browser withholds the reason deliberately.

So `core/parent-directory.js` guesses out loud instead, naming the
origin, the host and the two ways out:

```
The parent API at https://otadev.cheekoai.in/toy/api/mobile/parent-profile
did not answer http://localhost:3000 at all — no status, no body.
The likeliest cause by far is CORS: the API answers a browser only from an
origin on its allowlist, and a refused preflight is reported to JavaScript
exactly like a network failure.
Either add http://localhost:3000 to that allowlist server-side, or point
this page at a host that already allows it — append ?api=production,
?api=development or ?api=local to the URL, or ?api=standin to work with no
backend.
```

It reads "likeliest" because it is a guess; the real error is still
thrown and still logged. What it must never do is change the *decision*:
a blocked lookup is an unreachable backend, never a new parent. That is
asserted in `tests/auth-flow.test.mjs`.

### The registration form

The card's third mode. It is the Parent App's "Welcome to Cheeko" screen
([`assets/img/screens/parent-account.png`](assets/img/screens/parent-account.png))
field for field, so a parent who starts on the phone and finishes on the
web sees the same form: the email shown rather than asked for, parent
name, country code and mobile number, the language Cheeko speaks, and
four checkboxes. Continue stays disabled until the name, the number and
the three required boxes are all good — the fourth, marketing, is a
genuine choice.

The three required boxes are not sent as flags. The API records consent
as those three timestamps, and Continue cannot be reached without all
three, so submitting *is* the consent.

Two things follow the app's own quirks:

- **Name prefill** is `displayName`, else the local part of the email —
  usually close enough to be worth correcting rather than typing.
- **Phone length** is 10 digits, which is what the app validates for
  every country (`isValidLocalPhoneNumber`). Countries whose numbers
  really are a different length carry a `data-digits` override in the
  markup.

The Privacy Policy and Terms of Service link to the same Notion pages
the Parent App does (they are not on `cheekoai.in` — every path there
404s, which is what made them look missing). They are the documents
`terms_version` `2025-07-28` refers to, so if those URLs change because
the documents changed, that version string changes with them.

They open in a new tab so a parent halfway through the form does not
lose it. A link inside a `<label>` is the kind of thing that quietly
ticks the checkbox it sits in — it does not here, because an `<a href>`
is interactive content and the browser skips the label's activation
behaviour, but `tests/consent-links.test.mjs` pins that down rather
than trusting it. Someone reading a policy must never be recorded as
having accepted it.

### An interrupted registration

A parent can close the card mid-form, or reload. They then hold a
Firebase session with no Cheeko account, and the page treats them as
signed **out** — which is honest, because they have no account.

Pressing the header button walks straight back into the form with what
they typed still there, rather than through Google again. Nothing is
auto-opened on page load: popping a modal at someone who only reloaded
is rude. "Not your account? Use a different one" drops the Firebase
session so the chooser reappears.

### Running with no backend

With no API environment resolved — an empty `CHEEKO_PUBLIC_API_ENV`, an
empty URL for the selected one, or `?api=standin` —
`core/parent-directory.js` swaps the API for a `localStorage` stand-in,
keyed by Firebase uid. Register once and you are a returning parent from
then on, so both paths are reachable with no server and no CORS. It
speaks the same profile shape, so putting the real URL back changes no
call site.

`forgetLocalProfile(uid)` clears one stored profile, for walking the
new-parent path more than once. It only touches the stand-in — deleting
a real account is `DELETE /toy/api/mobile/account`, which belongs to the
app.

### What is stored where

| | Where | Why |
|---|---|---|
| the account | the parent-profile API | shared with the Parent App |
| name, email, phone, language | `localStorage` | so the account modal can paint before the next lookup returns |
| onboarding step | `localStorage` | front-end only |

The phone number is cleared on log out; the name and email survive, to
greet a returning parent before the lookup finishes. "Paired Devices"
and the subscription line in the account modal are still hardcoded
markup — there is nothing behind them yet.

### Device info

The Device Info section shows a card per toy on the signed-in parent's
account: its name, then child profile, MAC ID, firmware, board and OTA
auto-update, then its warranty. It is laid out mobile-first — one
column on a phone, the details as a strip of tiles from 760px. Three
reads, in parallel:

```
GET {base}/toy/api/mobile/devices?page=1&limit=100   the toys — required
    200 -> { data: { list: [{ macAddress, deviceName, kidId, board, appVersion,
                              autoUpdate, … }] } }
GET {base}/toy/api/mobile/devices/warranty           each toy's warranty — optional
    200 -> { data: [{ macAddress, deviceName, warranty: { registered, status,
                      warrantyStart, warrantyEnd, daysRemaining, warrantyMonths } }] }
GET {base}/toy/api/mobile/kids                       child names — optional
    200 -> [{ id, name, … }]
```

`/devices` is the Parent App's own list and is live on every host. It
is the section: if it fails, the section shows its error. The other two
only fill it in. Warranties are matched to toys by MAC, ignoring case
and separators. A failed or missing `/devices/warranty` (a host that
hasn't deployed it answers 404) leaves every toy listed, and each
warranty block says the details aren't available yet. A failed `/kids`
leaves "Child profile" as a dash. Both failures are logged with
`console.warn`, so a missing deploy stays visible.

It replaced a "Register your warranty" form that registered nothing. A
warranty is not something a parent files: the backend starts it the
first time a toy is activated with its 6-digit code in the Parent App —
**6 months**, in its own `device_warranty` table keyed by MAC, so an
unbind and rebind never restarts it. The heading said "1-Year", which
the backend never granted; it now says 6-month.

`status` is `active`, `expired` or `not_registered`. The last is real:
toys activated before warranties were recorded have no row until their
next activation or until an admin adds one, so the card says so and
points the parent at support with the MAC ID.

The endpoint is parent-scoped and deliberately narrower than the admin
view of the same record (`GET /toy/admin/device/:mac/warranty`, super-
admin only). It never returns `firstUser`: a warranty survives a change
of owner, so that can be the previous owner's name.

The section follows Firebase's sign-in state directly, not the page's
"signed in" flag, because it only needs an ID token and the flag waits
on the profile lookup. States: signed out (with a Sign in button),
loading, the list, no toys, error (with Try again), and unavailable —
stand-in mode, or a server that answers 404 for the device list. Device
and child names are the parent's own text and are only ever inserted
with `textContent`.

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
a demo; no form on the page uses that path any more.
