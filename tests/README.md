# Browser tests

Regression tests for sign-in, registration and the parent-profile API —
the parts where a wrong branch costs a parent their account.

They drive the **real page**. Only `core/firebase.js` is replaced, via
an import map injected into `index.html`, so `features/parent-auth.js`,
`core/parent-directory.js` and `core/app-state.js` are the shipped files
running unmodified. Google's popup is the one thing that cannot be
automated; everything downstream of it can.

## Running them

```bash
npm install && npx playwright install chromium   # once
npm run serve                                    # in another shell
npm test
npm run test:cors                                # the CORS matrix, separately
```

Port 3000 is required, not a preference: it is one of only two origins
any API host currently allows. See the CORS section of the main README.

`auth-flow.test.mjs` routes the API by **path** (`**/toy/api/mobile/**`)
rather than by host, because which host is in use is now
`core/api-environment.js`'s decision. Pinning a host there would break
the file every time `CHEEKO_PUBLIC_API_ENV` changed; that the right one
resolved is asserted once, in `smoke.test.mjs`.

| File | What it covers |
|---|---|
| `api-environment.test.mjs` | 27 checks on which backend resolves: the three `.env` hosts, the `?api=` override and that it sticks, aliases, `clear`, and every route into the stand-in — empty selector, empty URL, unknown value, `?api=standin`. Also that an unset selector never falls back to production. |
| `auth-flow.test.mjs` | 81 checks: new parent registers, returning parent signs straight in, a failed lookup does neither, a non-JSON 404 still means "new", the 401 refresh retry, log out. Plus the two-row write — that `user-state` is POSTed **before** `parent-profile`, that a 409 on it is success, and that a failure on it writes nothing at all. Plus the empty-profile case: finished with a PUT, never a POST. Asserts the create body field by field against the Parent App's contract. |
| `standin.test.mjs` | The `localStorage` stand-in that an empty `PARENT_API_BASE_URL` switches on: register, reload, be recognised, with the API never called. |
| `real-api.test.mjs` | The full host × origin matrix: which of the three configured API hosts a browser can reach, from which origin. Only a browser can answer this — curl ignores CORS, so an allowlist that omits the origin looks fine from the shell and blocks every request from the page. Reads the hosts out of the generated `env.js`, so it tracks `.env`. |
| `device-info.test.mjs` | The Device Info section against stubbed `GET /devices`, `/devices/warranty` and `/kids`: the old form is gone; signed out asks to sign in and requests nothing; each toy's card lists exactly its child profile, MAC ID, firmware, board and OTA auto-update, then its warranty status, days left and dates; at 320px and 390px nothing scrolls sideways and the details stack above the warranty; a warranty endpoint that 404s — production today — still lists every toy, saying only the warranty isn't available; an unreadable `/kids` leaves a dash; hostile device and child names stay text; empty, 404, 500-then-retry and stand-in each get their own state; signing out — even mid-request — clears the previous parent's toys. |
| `wizard-steps.test.mjs` | Taps Next Step through every step at phone and laptop sizes: each new step lands with its top just under the sticky header and all of it on screen, its own Next button included, so the parent never scrolls to read or to tap on. A step that already fits doesn't move the page. |
| `onboarding-finish.test.mjs` | "Finish Onboarding": step 5 swaps its actions for an "all set up" confirmation in place, ticks step 5 on the rail, moves focus to it, and puts **View Device Info** beside it (under it on a phone), which takes the parent to Device Info. Survives a reload; signing out starts the run over. |
| `press-feedback.test.mjs` | Presses real controls — primary button, stepper dot, store logo, header icon, a tab, a video card, an FAQ row — and measures them: each sinks to its size's `--press-scale-*` token while held, never below 88%, and springs back on release with nothing clicked. Desktop still lifts on hover; a phone never leaves a tapped button stuck in that lift. A tab's panel and an FAQ answer carry their entrance. |
| `consent-links.test.mjs` | That clicking the Privacy Policy or Terms link does **not** tick the consent box it sits inside, and that the sentence still does. |
| `smoke.test.mjs` | The page as it ships, no stubs: all three hosts load, the committed default resolves to **development** rather than production, the Firebase SDK loads, nothing else regressed. |

## Why the assertions are what they are

`auth-flow.test.mjs` checks the POST body key by key — `phone_number` in
E.164, `preferred_language` as a code not a label, `terms_version`, one
shared consent timestamp — because the Parent App reads the same record.
A field that drifts here is an account the app renders wrong, and that
is invisible from this side.

The "backend down" case asserts that **nothing is written** and the
registration form is **not** shown. Reading "could not ask" as "new
parent" is the one failure mode that costs real data: it walks a
registered parent into a second, empty account.

The two-row assertions exist for the same reason in the other
direction. Writing `parent-profile` without `user-state` leaves an
account that looks complete from this page and brand new to the phone —
and the phone's response to "brand new" is a form that always POSTs,
onto the row that already exists. The order assertion is the whole
point: a half-account fails in the least recoverable way, so the test
pins the order rather than just the presence of both calls.
