/**
 * features/device-info.js
 * The Device Info section: every Cheeko toy on the signed-in parent's
 * account — its child profile, MAC ID, firmware, board and OTA
 * auto-update setting — and its warranty, all read from the backend.
 *
 * The details come from the Parent App's own device list, so they are
 * the numbers the app and the admin dashboard show. The warranty is a
 * separate, newer read: a host without it still lists every toy, with
 * the warranty block saying so, rather than the whole section going
 * blank.
 *
 * A warranty is not something a parent files. The backend starts it the
 * first time a toy is activated with its 6-digit code in the Parent App,
 * and a rebind never restarts it — so this section shows it, and there
 * is no form.
 *
 * It follows Firebase's sign-in state directly rather than the page's
 * "signed in" flag. The list only needs an ID token, and that flag is set
 * later, after the profile lookup — which can fail on its own and would
 * leave this section waiting forever.
 *
 * Device and child names are the parent's own text, so everything here
 * is built with textContent, never innerHTML.
 */

import { byId, qsa, setVisible } from "../core/dom.js";
import { watchAuthState } from "../core/firebase.js";
import { fetchAccountDevices, isBackendLive } from "../core/parent-directory.js";

const SUPPORT_EMAIL = "hello@altio.me";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Label and colour for each warranty status the backend reports. */
const WARRANTY_STATUS = {
  active:         { label: "Active",        modifier: "active" },
  expired:        { label: "Expired",       modifier: "expired" },
  not_registered: { label: "Not on record", modifier: "missing" },
};

const WARRANTY_UNAVAILABLE = "Warranty details aren't available just yet. Please check back soon.";

const UNAVAILABLE_COPY = {
  standin: "Device details come from the Cheeko server, and this page is running "
    + "without one (stand-in mode), so there is nothing to show here.",
  notDeployed: "Device details aren't available just yet. Please check back soon.",
  noSignIn: "Sign-in isn't available right now, so we can't show your devices.",
};

/** A new element with a class and, optionally, text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const formatDate = (value) => (toDate(value) ? DATE.format(toDate(value)) : "—");

/** One detail row. `value` is text or an element; empty reads as a dash. */
function fact(term, value, valueClass = "") {
  const row = el("div", "toy-card__fact");
  const detail = el("dd", valueClass);
  detail.append(value || "—");
  row.append(el("dt", "", term), detail);
  return row;
}

/** "On" / "Off" as a small status pill; unknown stays a dash, not "Off". */
function otaPill(on) {
  if (on === null) return "";
  return el("span", `toy-card__pill toy-card__pill--${on ? "on" : "off"}`, on ? "On" : "Off");
}

function renderFacts(device) {
  const facts = el("dl", "toy-card__facts");
  facts.append(
    fact("Child profile", device.kidName),
    fact("MAC ID", device.macAddress, "toy-card__mono"),
    fact("Firmware", device.firmware),
    fact("Board", device.board),
    fact("OTA auto-update", otaPill(device.otaAutoUpdate)),
  );
  return facts;
}

/** How much of the cover has been used, 0–100, for the bar. */
function elapsedPercent({ start, end }, now) {
  const from = toDate(start)?.getTime();
  const to = toDate(end)?.getTime();
  if (!from || !to || to <= from) return 0;
  return Math.round(Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100)));
}

function renderWarranty(warranty, now) {
  const block = el("div", "device-warranty");

  // The read failed, or this host doesn't have it yet. Say so, and let
  // the rest of the card stand.
  if (!warranty) {
    block.append(el("p", "device-warranty__note", WARRANTY_UNAVAILABLE));
    return block;
  }

  const status = WARRANTY_STATUS[warranty.status] || WARRANTY_STATUS.not_registered;
  block.classList.add(`device-warranty--${status.modifier}`);

  const top = el("div", "device-warranty__top");
  top.append(el("span", "device-warranty__status", status.label));
  block.append(top);

  if (!warranty.registered) {
    // Toys activated before warranties were recorded have no record until
    // the next 6-digit activation or until support adds one by hand.
    const note = el("p", "device-warranty__note");
    const mail = el("a", "", SUPPORT_EMAIL);
    mail.href = `mailto:${SUPPORT_EMAIL}`;
    note.append("We don't have a warranty on record for this toy yet. Email ", mail,
      " with the MAC ID above and we'll add it.");
    block.append(note);
    return block;
  }

  const active = warranty.status === "active";
  const days = el("p", "device-warranty__days");
  if (active) {
    const count = warranty.daysRemaining;
    days.append(el("strong", "", String(count)), ` ${count === 1 ? "day" : "days"} remaining`);
  } else {
    days.textContent = "Out of warranty";
  }
  top.append(days);

  // Decorative: the days line above already says it in words.
  const bar = el("div", "device-warranty__bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = el("span", "device-warranty__fill");
  fill.style.width = `${active ? elapsedPercent(warranty, now) : 100}%`;
  bar.append(fill);

  const dates = el("p", "device-warranty__dates");
  dates.append(
    el("span", "", `Started ${formatDate(warranty.start)}`),
    el("span", "", `${active ? "Ends" : "Ended"} ${formatDate(warranty.end)}`),
  );
  block.append(bar, dates);
  return block;
}

/** A labelled block inside a card. */
function section(label, content) {
  const block = el("div", "toy-card__section");
  block.append(el("h4", "toy-card__label", label), content);
  return block;
}

/** One toy's card: its name, its details, then its warranty. */
function renderDevice(device, now) {
  const item = el("li", "toy-card");

  const body = el("div", "toy-card__body");
  body.append(
    section("Device", renderFacts(device)),
    section("Warranty", renderWarranty(device.warranty, now)),
  );

  item.append(el("h3", "toy-card__name", device.name || "Cheeko"), body);
  return item;
}

export function initDeviceInfo({ openAuthModal } = {}) {
  const panel = byId("deviceInfoPanel");
  if (!panel) return;

  const list = byId("deviceList");
  const unavailableText = byId("deviceUnavailableText");
  const views = qsa("[data-device-view]", panel);

  /** Show exactly one view. */
  function show(name) {
    views.forEach((view) => setVisible(view, view.dataset.deviceView === name));
  }

  function showUnavailable(copy) {
    unavailableText.textContent = copy;
    show("unavailable");
  }

  // Each load takes a ticket; a result whose ticket is no longer current
  // (signed out, or retried, while it was in flight) is dropped.
  let ticket = 0;

  async function load() {
    const mine = ++ticket;

    if (!isBackendLive) {
      showUnavailable(UNAVAILABLE_COPY.standin);
      return;
    }

    show("loading");
    try {
      const devices = await fetchAccountDevices();
      if (mine !== ticket) return;

      if (!devices || !devices.length) {
        list.replaceChildren();
        show("empty");
        return;
      }
      const now = Date.now();
      list.replaceChildren(...devices.map((device) => renderDevice(device, now)));
      show("list");
    } catch (error) {
      if (mine !== ticket) return;
      console.error("Could not load the account's devices:", error);
      if (error?.status === 404) showUnavailable(UNAVAILABLE_COPY.notDeployed);
      else show("error");
    }
  }

  qsa("[data-device-retry]", panel).forEach((button) => button.addEventListener("click", load));
  qsa("[data-device-signin]", panel).forEach((button) =>
    button.addEventListener("click", () => openAuthModal?.()));

  show("checking");
  watchAuthState((user) => {
    if (user) {
      load();
      return;
    }
    ticket += 1;
    list.replaceChildren();
    show("signed-out");
  }).catch((error) => {
    console.error("Firebase Auth could not load — the Device Info section cannot sign in:", error);
    showUnavailable(UNAVAILABLE_COPY.noSignIn);
  });
}
