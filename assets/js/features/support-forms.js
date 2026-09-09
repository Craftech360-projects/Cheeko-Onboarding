/**
 * features/support-forms.js
 * Warranty registration and the support ticket form.
 *
 * A form carrying [data-email-subject] is sent for real: it POSTs to
 * Web3Forms, which relays it to the inbox behind WEB3FORMS_ACCESS_KEY.
 * Any other [data-success-message] form stays a front-end demo and
 * simply swaps itself for its banner.
 *
 * Both paths are wired generically off data attributes, so turning a
 * demo form into a live one is an attribute, not new JavaScript.
 */

import { qs, byId, qsa, setVisible } from "../core/dom.js";
import { WEB3FORMS_ACCESS_KEY } from "../core/config.js";

const ENDPOINT = "https://api.web3forms.com/submit";
const SENDING_LABEL = "Sending…";
const TICKET_PREFIX = "CK-";

/**
 * A four-digit ticket such as "#CK-4821", minted in the browser.
 *
 * Four digits is 9,000 possible tickets and nothing checks one against
 * the last, so two parents can be handed the same number — see the
 * README before treating this as a unique key.
 */
function newTicketId() {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return `#${TICKET_PREFIX}${1000 + (n % 9000)}`;
}

/** Every named control in the form, as a plain object. */
function readFields(form) {
  const fields = {};
  new FormData(form).forEach((value, key) => { fields[key] = value; });
  return fields;
}

/**
 * Hand the form to Web3Forms. Resolves on delivery, throws otherwise —
 * the caller decides what the parent sees.
 *
 * Key order is the order the email lists them, so the ticket leads.
 */
async function sendToInbox(form, { subject, ticket }) {
  if (!WEB3FORMS_ACCESS_KEY) {
    throw new Error(
      "WEB3FORMS_ACCESS_KEY is empty — add the key in assets/js/core/config.js",
    );
  }

  const fields = readFields(form);
  const body = {
    access_key: WEB3FORMS_ACCESS_KEY,
    // The ticket rides in the subject too, so it is searchable in the inbox.
    subject: ticket ? `${subject} — ${ticket}` : subject,
    from_name: "Cheeko Setup & Support",
    // So hitting reply in the inbox answers the parent, not the relay.
    replyto: fields.email || "",
  };
  if (ticket) body["Ticket ID"] = ticket;
  Object.assign(body, fields);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || `Web3Forms responded ${response.status}`);
  }
}

export function initSupportForms() {
  qsa("[data-success-message]").forEach((form) => {
    const banner = byId(form.dataset.successMessage);
    const errorBanner = form.dataset.errorMessage
      ? byId(form.dataset.errorMessage)
      : null;
    const ticketSlot = form.dataset.ticketSlot
      ? byId(form.dataset.ticketSlot)
      : null;
    const subject = form.dataset.emailSubject;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      // No subject means the form was never wired to an inbox.
      if (!subject) {
        setVisible(form, false);
        setVisible(banner, true);
        return;
      }

      const submitButton = qs("button[type='submit']", form);
      const idleLabel = submitButton ? submitButton.textContent : "";

      // Minted before sending so the parent and the inbox quote the same
      // number. If the send fails it is simply thrown away.
      const ticket = ticketSlot ? newTicketId() : null;

      setVisible(errorBanner, false);
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = SENDING_LABEL;
      }

      try {
        await sendToInbox(form, { subject, ticket });
        if (ticketSlot) ticketSlot.textContent = ticket;
        setVisible(form, false);
        setVisible(banner, true);
      } catch (error) {
        // The banner tells the parent what to do; the console tells us why.
        console.error("Support request was not sent:", error);
        setVisible(errorBanner, true);
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = idleLabel;
        }
      }
    });
  });
}
