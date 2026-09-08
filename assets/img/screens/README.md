# Parent App screenshots

Exports of the real Parent App screens, shown beside each wizard step.

| File | Used by | Screen |
|---|---|---|
| `parent-account.png` | Step 02 — Create a Parent Account | "Welcome to Cheeko" registration form |
| `wifi-setup.png` | Step 03 — Connect Cheeko to Wi-Fi | "Select Wi-Fi" network list |
| `pair-device.png` | Step 04 — Pair your Device | "Ready to Bring Cheeko to Life?" pairing checks |

Each step's `screen-showcase__title` and `__text` in `onboarding.html`
describe the screen sitting next to them — swap an image and the copy
beside it has to change too.

## These ship framed

The current exports already carry their own iPhone frame on a transparent
background, so they go straight into the `screen-showcase__device` slot as
`<img class="screen-showcase__shot">`. The frame width lives in
`components/screen-showcase.css` (250px, 268px from 900px up); the drop
shadow is a `filter`, so it follows the rounded phone edge.

**Swapping in an unframed export?** Wrap it back in the CSS phone shell —
the component is still there and still documented:

```html
<div class="phone">
  <span class="phone__island" aria-hidden="true"></span>
  <img class="phone__screen" src="…" alt="…" width="" height="">
</div>
```

That frame keeps a 9 / 19.5 ratio and scales the shot to fit, pinned to the
top, so an odd ratio leaves a band of screen colour at the bottom rather
than cropping the button at the foot of the screen.

## Preparing a file

`source/` holds the originals as they were handed over. The versions the
page loads were, from those:

1. **background keyed out** — flood-filled from the four corners, so the
   phone sits on the panel's cream rather than a white rectangle
2. **cropped** to the frame's own bounding box, so all three line up
3. **resized to 620px wide** — the frame is 268px at its largest, so this
   is 2× for retina and no more
4. **quantised to 200 colours**, which takes ~1 MB down to ~50 KB with no
   visible loss on flat app UI

Keep the `width` / `height` attributes on each `<img>` in
`onboarding.html` matching the real pixel size: they reserve the layout
box, and the wizard measures panel heights to size its viewport.

Images here are **not** lazy-loaded. Steps 2–4 sit off-screen inside the
slider, so `loading="lazy"` defers them until the panel slides in, and the
late reflow makes the wizard resize under the reader.
