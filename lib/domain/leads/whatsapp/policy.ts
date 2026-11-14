import type { WhatsAppConsentSource } from "@prisma/client";

import { DomainValidationError } from "../../errors";
import type {
  WhatsAppBusinessNumber,
  WhatsAppChannel,
} from "../../ports/whatsapp";
import { normaliseLeadPhone, type NormalisedLeadPhone } from "./phone";

// May this lead be sent this kind of WhatsApp message, from this number, now?
//
// One pure function, so the modal's "why can't I send?" and the command's
// refusal are the same sentence from the same rule. The command re-evaluates
// it against fresh rows every time; the screen's copy is advice.
//
// The platform rules, as modelled (verify against Meta's current docs when
// they change — docs/whatsapp-runbook.md records the check):
//
//   - A free-form message is only delivered inside the customer-service
//     window: CUSTOMER_SERVICE_WINDOW_MS after the customer's last message to
//     that business number.
//   - Outside it, only an approved template is delivered.
//
// And Royal's own rules on top:
//
//   - A valid phone is not consent. A template (proactive outreach) needs a
//     recorded consent, unless the customer has themselves opened a window.
//   - An opt-out blocks everything, including replies inside a window.
//   - An archived lead is never messaged.

/** Meta's customer-service window. Modelled, not assumed at call sites. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Meta's limit on a text message body. */
export const MAX_WHATSAPP_TEXT_LENGTH = 4096;

export type WhatsAppConversationWindow = {
  readonly businessPhoneNumberId: string;
  readonly customerPhoneE164: string;
  readonly lastInboundAt: Date | null;
  readonly windowExpiresAt: Date | null;
};

export type WhatsAppPolicyLead = {
  readonly phone: string;
  readonly isArchived: boolean;
  readonly whatsappConsentAt: Date | null;
  readonly whatsappConsentSource: WhatsAppConsentSource | null;
  readonly whatsappOptedOutAt: Date | null;
};

export type WhatsAppEligibility = {
  readonly phone: NormalisedLeadPhone;
  readonly sender: WhatsAppBusinessNumber | null;
  readonly window: { readonly open: boolean; readonly expiresAt: Date | null };
  readonly consent: {
    readonly recorded: boolean;
    readonly at: Date | null;
    readonly source: WhatsAppConsentSource | null;
  };
  readonly optedOut: boolean;
  readonly archived: boolean;
  readonly sendingAvailable: boolean;
  readonly text: { readonly allowed: boolean; readonly reason: string | null };
  readonly template: {
    readonly allowed: boolean;
    readonly reason: string | null;
  };
};

export const WHATSAPP_REFUSALS = {
  archived: "This lead is archived, so it can no longer be messaged.",
  noSender:
    "No WhatsApp Business number is configured for this deployment. An administrator needs to add one before anyone can send.",
  noSending:
    "WhatsApp sending isn't available here — the provider isn't configured in this runtime. Use the Leads screen in the app, or check the WhatsApp configuration.",
  optedOut:
    "This lead asked not to be contacted on WhatsApp. Record fresh consent before messaging them again.",
  noConsent:
    "There's no recorded WhatsApp consent for this lead, and they haven't messaged in the last 24 hours. Record how they agreed to be contacted on WhatsApp before sending a template.",
  windowClosed:
    "The customer hasn't messaged this number in the last 24 hours, so WhatsApp only delivers an approved template. Choose a template instead.",
} as const;

export function isWindowOpen(
  conversation: Pick<WhatsAppConversationWindow, "windowExpiresAt"> | null,
  now: Date,
): boolean {
  return Boolean(
    conversation?.windowExpiresAt
    && conversation.windowExpiresAt.getTime() > now.getTime(),
  );
}

/** The window a message received at `receivedAt` opens. */
export function windowExpiryFor(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
}

/**
 * Which Royal number a message to this lead goes from.
 *
 * An explicit choice must be a configured number. Otherwise: the number the
 * customer most recently wrote to while its window is still open (so a reply
 * lands in the thread they are reading), then the configured default, then
 * the first configured number.
 */
export function chooseWhatsAppSender(
  channel: WhatsAppChannel | null,
  conversations: readonly WhatsAppConversationWindow[],
  customerPhoneE164: string | null,
  now: Date,
  requestedPhoneNumberId?: string | null,
): WhatsAppBusinessNumber | null {
  const numbers = channel?.numbers ?? [];
  if (requestedPhoneNumberId) {
    const requested = numbers.find(
      (number) => number.phoneNumberId === requestedPhoneNumberId,
    );
    if (!requested) {
      throw new DomainValidationError(
        "That WhatsApp sender number isn't configured for this deployment.",
        "businessPhoneNumberId",
      );
    }
    return requested;
  }
  if (numbers.length === 0) return null;

  const open = conversations
    .filter(
      (conversation) =>
        conversation.customerPhoneE164 === customerPhoneE164
        && isWindowOpen(conversation, now),
    )
    .sort(
      (a, b) =>
        (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0),
    );
  for (const conversation of open) {
    const match = numbers.find(
      (number) => number.phoneNumberId === conversation.businessPhoneNumberId,
    );
    if (match) return match;
  }

  return (
    numbers.find(
      (number) => number.phoneNumberId === channel?.defaultPhoneNumberId,
    ) ?? numbers[0]
  );
}

export function evaluateWhatsAppEligibility(input: {
  readonly lead: WhatsAppPolicyLead;
  readonly channel: WhatsAppChannel | null;
  readonly conversations: readonly WhatsAppConversationWindow[];
  readonly now: Date;
  readonly requestedPhoneNumberId?: string | null;
}): WhatsAppEligibility {
  const { lead, channel, conversations, now } = input;
  const phone = normaliseLeadPhone(lead.phone);
  const sender = chooseWhatsAppSender(
    channel,
    conversations,
    phone.e164,
    now,
    input.requestedPhoneNumberId,
  );
  const conversation = sender
    ? (conversations.find(
        (candidate) =>
          candidate.businessPhoneNumberId === sender.phoneNumberId
          && candidate.customerPhoneE164 === phone.e164,
      ) ?? null)
    : null;
  const windowOpen = isWindowOpen(conversation, now);
  const consentRecorded = lead.whatsappConsentAt !== null;
  const optedOut = lead.whatsappOptedOutAt !== null;
  const sendingAvailable = channel?.sendingAvailable === true;

  // Order matters: the first reason that applies is the one the operator can
  // act on, so "archived" beats "no phone", which beats "no consent".
  const common = lead.isArchived
    ? WHATSAPP_REFUSALS.archived
    : !phone.usable
      ? phone.reason
      : optedOut
        ? WHATSAPP_REFUSALS.optedOut
        : !sender
          ? WHATSAPP_REFUSALS.noSender
          : !sendingAvailable
            ? WHATSAPP_REFUSALS.noSending
            : null;

  const textReason =
    common ?? (windowOpen ? null : WHATSAPP_REFUSALS.windowClosed);
  const templateReason =
    common
    ?? (windowOpen || consentRecorded ? null : WHATSAPP_REFUSALS.noConsent);

  return {
    archived: lead.isArchived,
    consent: {
      at: lead.whatsappConsentAt,
      recorded: consentRecorded,
      source: lead.whatsappConsentSource,
    },
    optedOut,
    phone,
    sender,
    sendingAvailable,
    template: { allowed: templateReason === null, reason: templateReason },
    text: { allowed: textReason === null, reason: textReason },
    window: {
      expiresAt: conversation?.windowExpiresAt ?? null,
      open: windowOpen,
    },
  };
}
