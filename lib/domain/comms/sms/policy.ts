import type { CommsBusinessNumber, CommsChannel } from "../../ports/comms";
import {
  normaliseLeadPhone,
  type NormalisedLeadPhone,
} from "../../leads/whatsapp/phone";

// May this lead be sent an SMS now, and from which number?
//
// One pure function, so the composer's "why can't I send?" and the command's
// refusal are the same sentence from the same rule. The command re-evaluates
// it against fresh rows every time; the screen's copy is advice.
//
// The rules (README, "Australian compliance"):
//
//   - A lead who texted STOP gets nothing until they text START or an
//     operator records fresh consent. Spam Act 2003: honour it immediately.
//   - An archived lead is never messaged.
//   - The message goes to the lead's own primary phone, never a number the
//     caller supplies, and from the active provider's own number.
//
// Royal texts leads who enquired about a build. That is a reply to an
// enquiry, not marketing, so no separate SMS consent is recorded; anything
// promotional must not go through this path.

/** Ten segments of GSM-7. Long enough for any reply; short enough to stop a paste. */
export const MAX_SMS_LENGTH = 1530;

export const SMS_REFUSALS = {
  archived: "This lead is archived, so it can no longer be texted.",
  noPhone:
    "This lead has no phone number. Add a mobile number to text or call them.",
  invalidPhone:
    "This lead's phone number is not a complete, valid number. Correct it (with the country code if it is not Australian) to text or call them.",
  noSender:
    "No SMS number is configured for the active phone provider. An administrator needs to add one to COMMS_PHONE_NUMBERS.",
  noSending:
    "SMS isn't available here — the phone provider isn't configured in this runtime.",
  optedOut:
    "This lead replied STOP, so they can't be texted. They can text START to opt back in.",
} as const;

export type SmsEligibility = {
  readonly phone: NormalisedLeadPhone;
  readonly sender: CommsBusinessNumber | null;
  readonly optedOut: boolean;
  readonly allowed: boolean;
  readonly reason: string | null;
};

export function evaluateSmsEligibility(input: {
  readonly lead: {
    readonly phone: string;
    readonly isArchived: boolean;
    readonly smsOptedOutAt: Date | null;
  };
  readonly channel: CommsChannel | null;
}): SmsEligibility {
  const phone = normaliseLeadPhone(input.lead.phone);
  const sender = input.channel?.defaultNumber ?? null;
  const optedOut = input.lead.smsOptedOutAt !== null;
  // The first reason that applies is the one the operator can act on.
  const reason = input.lead.isArchived
    ? SMS_REFUSALS.archived
    : !phone.usable
      ? phone.raw
        ? SMS_REFUSALS.invalidPhone
        : SMS_REFUSALS.noPhone
      : optedOut
        ? SMS_REFUSALS.optedOut
        : !sender
          ? SMS_REFUSALS.noSender
          : !input.channel?.smsAvailable
            ? SMS_REFUSALS.noSending
            : null;
  return { allowed: reason === null, optedOut, phone, reason, sender };
}

/** Keywords carriers and the Spam Act treat as "stop texting me". */
const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "OPT OUT",
]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN", "OPT IN"]);

function keyword(body: string): string {
  return body
    .trim()
    .replace(/[.!]+$/, "")
    .toUpperCase();
}

/** A whole message that is an opt-out keyword. "Stop by at 5" is not. */
export function isOptOutMessage(body: string): boolean {
  return STOP_WORDS.has(keyword(body));
}

/**
 * A whole message that re-subscribes. "YES" only counts for someone who has
 * opted out — otherwise it is just a reply.
 */
export function isOptInMessage(body: string): boolean {
  return START_WORDS.has(keyword(body));
}

/** GSM-7 or UCS-2, and how many billed segments the body is. */
export function smsSegments(body: string): {
  encoding: "GSM-7" | "UCS-2";
  segments: number;
} {
  // The GSM 03.38 basic set plus its extension table, which costs two septets.
  const basic =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const extended = "^{}\\[~]|€\f";
  let septets = 0;
  for (const char of body) {
    if (basic.includes(char)) septets += 1;
    else if (extended.includes(char)) septets += 2;
    else {
      const units = [...body].length;
      return {
        encoding: "UCS-2",
        segments: units <= 70 ? 1 : Math.ceil(units / 67),
      };
    }
  }
  return {
    encoding: "GSM-7",
    segments: septets <= 160 ? 1 : Math.ceil(septets / 153),
  };
}
