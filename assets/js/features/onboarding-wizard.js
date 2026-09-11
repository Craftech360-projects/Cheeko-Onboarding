/**
 * features/onboarding-wizard.js
 * The five-step setup slider and its stepper rail.
 *
 * The viewport hugs the *active* panel rather than the tallest one, so a
 * short step doesn't leave a screen of dead space on mobile. A
 * MutationObserver watches the visible panel, which means a step can grow
 * and shrink its own markup without knowing the wizard exists.
 *
 * Height and slide are one movement. Growing happens before the slide so
 * a taller card never arrives clipped; shrinking waits until the slide
 * has finished so the card leaving is never cut off on its way out.
 */

import { byId, qsa, setVisible } from "../core/dom.js";
import { appState, advanceToStep, completeOnboarding, FIRST_STEP, LAST_STEP } from "../core/app-state.js";

const PANEL_WIDTH_PERCENT = 100 / LAST_STEP;

/** Matches --wizard-slide in pages/onboarding.css. */
const SLIDE_MS = 500;

export function initOnboardingWizard() {
  const viewport = byId("wizardViewport");
  const track = byId("wizardTrack");
  if (!viewport || !track) return { refresh: () => {} };

  const panels = qsa(".wizard__panel", track);
  const dots = qsa(".stepper__dot");
  const lines = qsa(".stepper__line");
  const finishViews = qsa("[data-finish-view]", track);
  const finishTitle = byId("finishTitle");

  let visibleStep = appState.onboardingStep;

  /* ---------- height sync ----------
     Four things can change the height of the visible step:
       1. moving to another step        -> showStep() measures directly
       2. a step changing its own DOM   -> MutationObserver below
       3. reflow (window resize, fonts) -> resize event + fonts.ready
       4. a screenshot decoding late    -> image load listeners
     (2) is what lets a step expand and collapse its own markup
     without needing to know the wizard exists.

     Only one of these is worth animating: settling onto a shorter card
     after a slide. Everything else is the page correcting its own
     measurements, and animating that just looks like a glitch. */

  const activePanelHeight = () => panels[visibleStep - 1]?.offsetHeight ?? 0;

  function applyHeight(height, { animate = false } = {}) {
    if (!height) return;
    if (animate) {
      viewport.style.height = `${height}px`;
      return;
    }
    viewport.classList.add("wizard__viewport--instant");
    viewport.style.height = `${height}px`;
    void viewport.offsetHeight;          // flush, so the next change animates again
    viewport.classList.remove("wizard__viewport--instant");
  }

  /** Re-measure the visible step and match it, without animating. */
  function syncHeight() {
    applyHeight(activePanelHeight());
  }

  const contentObserver = new MutationObserver(syncHeight);

  function observeActivePanel() {
    contentObserver.disconnect();
    const panel = panels[visibleStep - 1];
    if (!panel) return;
    contentObserver.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
  }

  window.addEventListener("resize", syncHeight);

  // Web fonts land after first paint and reflow every card.
  document.fonts?.ready.then(syncHeight);

  // A screenshot that decodes late changes its panel's height, and an
  // image load is not a DOM mutation, so the observer above never sees it.
  qsa("img", track).forEach((image) => {
    if (!image.complete) image.addEventListener("load", syncHeight, { once: true });
  });

  /* ---------- navigation ---------- */
  let settleTimer = 0;

  /** Room left between the sticky header and a step brought into view. */
  const HEADER_GAP = 12;

  /**
   * Put the step the parent just moved to where they can read it whole:
   * its top just under the sticky header. Only moves the page when the
   * card is cut off — top hidden above, or bottom below the screen — so a
   * step that already fits is left where it is.
   *
   * Scrolls the window by hand rather than calling scrollIntoView on the
   * card: the card sits in an overflow:hidden viewport, and scrollIntoView
   * would scroll that sideways too, undoing the slide.
   */
  function bringStepIntoView() {
    const card = panels[visibleStep - 1]?.querySelector(".step-card");
    if (!card) return;

    const header = document.querySelector(".site-header")?.offsetHeight ?? 0;
    const { top, bottom } = card.getBoundingClientRect();
    if (top >= header && bottom <= window.innerHeight) return;

    // No behavior here: reset.css makes it smooth, or instant for anyone
    // who asked for reduced motion.
    window.scrollTo({ top: window.scrollY + top - header - HEADER_GAP });
  }

  function showStep(step) {
    // No inline height yet means this is the first paint, where the
    // viewport is still as tall as the tallest panel. Snap, never animate.
    const isFirstPaint = !viewport.style.height;
    const outgoingHeight = isFirstPaint ? 0 : viewport.offsetHeight;

    visibleStep = Math.min(Math.max(step, FIRST_STEP), LAST_STEP);
    observeActivePanel();

    // Measure now: reading offsetHeight forces the layout we need, and a
    // panel's height does not depend on the transform we are about to set.
    const incomingHeight = activePanelHeight();

    // Grow before the slide, so a taller card never arrives clipped; hold
    // the taller of the two through the slide, so the card on its way out
    // is never cut off either.
    applyHeight(Math.max(incomingHeight, outgoingHeight));

    track.style.transform = `translateX(${-(visibleStep - 1) * PANEL_WIDTH_PERCENT}%)`;

    // Then, and only then, ease down onto a shorter card.
    clearTimeout(settleTimer);
    if (incomingHeight < outgoingHeight) {
      settleTimer = setTimeout(() => applyHeight(activePanelHeight(), { animate: true }), SLIDE_MS);
    }
  }

  /**
   * Paint the rail: steps before the furthest reached are complete, that
   * step is active, the rest are pending.
   */
  function paintStepper() {
    dots.forEach((dot, index) => {
      const step = index + 1;
      dot.classList.toggle("stepper__dot--complete",
        step < appState.onboardingStep || appState.onboardingComplete);
      dot.classList.toggle("stepper__dot--active", step === visibleStep);
      dot.setAttribute("aria-current", step === visibleStep ? "step" : "false");
    });

    lines.forEach((line, index) => {
      line.classList.toggle("stepper__line--complete", index + 1 < appState.onboardingStep);
    });
  }

  /** Step 5 shows its actions until setup is finished, then the confirmation. */
  function paintFinish() {
    const view = appState.onboardingComplete ? "done" : "pending";
    finishViews.forEach((element) => setVisible(element, element.dataset.finishView === view));
  }

  /** Re-sync the whole wizard with app state. Safe to call any time. */
  function refresh({ goToCurrentStep = true } = {}) {
    if (goToCurrentStep) showStep(appState.onboardingStep);
    paintStepper();
    paintFinish();
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      showStep(Number(dot.dataset.step));
      paintStepper();
      bringStepIntoView();
    });
  });

  qsa("[data-wizard-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.wizardNext);

      // Record the progress, then go where the button says. Not
      // refresh(): on a step the parent has stepped back to, the furthest
      // step reached is still ahead of this one, and following that would
      // throw them forward instead of on to the next card.
      advanceToStep(next);
      showStep(next);
      paintStepper();
      // The button that was tapped sat at the bottom of the old step, so
      // without this the parent lands partway down the new one.
      bringStepIntoView();
    });
  });

  // Finishing swaps step 5 for its confirmation, in place. The viewport
  // resizes itself — the observer sees the swap — and focus moves to the
  // confirmation, because the button that had it is gone.
  byId("finishOnboardingBtn")?.addEventListener("click", () => {
    completeOnboarding();
    paintStepper();
    paintFinish();
    finishTitle?.focus({ preventScroll: true });
  });

  // "View Device Info", beside the confirmation. The one place the wizard
  // scrolls the page: here the parent asked to go somewhere else.
  qsa("[data-scroll-to]", track).forEach((button) => {
    button.addEventListener("click", () => {
      const target = byId(button.dataset.scrollTo);
      // No behavior here: reset.css makes it smooth, or instant for
      // anyone who asked for reduced motion.
      target?.scrollIntoView({ block: "start" });
      target?.querySelector("h2")?.focus({ preventScroll: true });
    });
  });

  refresh();
  // One late pass after web fonts settle, so the first height is right.
  setTimeout(syncHeight, 120);

  return { refresh, syncHeight };
}
