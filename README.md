# Cheeko — Setup & Onboarding page

The `onboarding.html` page of cheekoai.in: a five-step device setup wizard, a
parent dashboard, and the support/documentation section.

Previously this was a single 1,447-line `start-minimal.html` with the CSS,
the JavaScript and a base64-encoded logo all inlined. It is now split into
a conventional static-site structure.

## Structure

```
.
├── onboarding.html               the page (markup only)
├── README.md
└── assets/
    ├── img/
    │   ├── cheeko-logo.png       was a 37 KB base64 data URI in the markup
    │   └── screens/              Parent App screenshots (see its README)
    ├── css/
    │   ├── main.css              the only stylesheet the page links
    │   ├── base/                 tokens, reset, typography, utilities
    │   ├── layout/               page shell: header, nav, footer, ticker
    │   ├── components/           reusable blocks (button, modal, tabs, …)
    │   └── pages/                view-specific composition
    └── js/
        ├── main.js               entry point (ES module)
        ├── core/                 storage, persisted state, DOM helpers
        ├── components/           reusable UI behaviour
        ├── features/             this page's screens
        └── layout/               site chrome
```

### CSS

`main.css` is the single entry point; everything else arrives through
`@import`, and **import order is cascade order**:

| Layer | Contains | May override |
|---|---|---|
| `base/` | tokens, reset, type scale, `is-*` utilities | — |
| `layout/` | container, header, nav, footer, ticker | base |
| `components/` | button, form, panel, phone, modal, tabs, accordion, switch, store-badges, lists, media, screen-showcase, segmented | base, layout |
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
| `core/storage.js` | `localStorage` with an in-memory fallback for Safari with cookies blocked |
| `core/app-state.js` | all persisted state + setters + change subscription |
| `core/dom.js` | `qs` / `qsa` / `byId` / `setVisible` |
| `components/modal.js` | open, close, backdrop, Escape, scroll lock |
| `components/info-tabs.js` | support tab strip |
| `components/faq-accordion.js` | single-open FAQ |
| `components/video-modal.js` | simulated tutorial player |
| `features/onboarding-wizard.js` | the five-step slider and progress rail |
| `features/parent-auth.js` | sign up / log in / log out |
| `features/parent-dashboard.js` | safety controls, resource shortcuts |
| `features/support-forms.js` | warranty + support ticket forms |
| `layout/site-header.js` | scrolls the active nav link into view |

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
# then open http://localhost:8000/onboarding.html
```

## Notes

- The **Download the Parent App** step (step 1) links to the live stores:
  [App Store](https://apps.apple.com/in/app/cheekoai/id6748904798) ·
  [Google Play](https://play.google.com/store/apps/details?id=com.cheekoai.in)
- Auth and the forms are **front-end simulations**. Nothing
  is sent anywhere; progress is remembered in `localStorage` only.
