import { parsePhoneNumberFromString } from "libphonenumber-js";

// When is a lead's phone a WhatsApp destination?
//
// "It has digits in it" is the rule this replaces, and it is the wrong one: a
// landline typed as "9876 5432", "0400 000 00" with a digit missing, or "call
// after 5pm" all pass it. Sending to a guess of what the operator meant is how
// a message reaches the wrong person, which is the expensive failure here.
//
// So a phone is usable only when it parses to a valid E.164 number, reading a
// number with no country code as Australian — every lead so far is in NSW.
// Pure and dependency-light on purpose: the lead list gates its WhatsApp
// button on this in the browser, the domain gates the send on it, and the
// inbound webhook matches on what it stored. One function, three callers.

/** Leads without a country code are read as Australian. */
export const DEFAULT_PHONE_REGION = "AU";

export type NormalisedLeadPhone =
  | { readonly usable: true; readonly e164: string; readonly raw: string }
  | {
      readonly usable: false;
      readonly e164: null;
      readonly raw: string;
      /** Operator-readable: why the button is disabled. */
      readonly reason: string;
    };

const MISSING =
  "This lead has no phone number. Add a mobile number to message them on WhatsApp.";
const INVALID =
  "This lead's phone number is not a complete, valid number. Correct it (with the country code if it is not Australian) to message them on WhatsApp.";

export function normaliseLeadPhone(
  raw: string | null | undefined,
): NormalisedLeadPhone {
  const value = (raw ?? "").trim();
  if (!value) return { raw: value, reason: MISSING, usable: false, e164: null };

  // "0061 4…" and "+61 4…" are both international forms; libphonenumber only
  // recognises the second.
  const candidate = value.startsWith("00") ? `+${value.slice(2)}` : value;
  const parsed = parsePhoneNumberFromString(candidate, DEFAULT_PHONE_REGION);
  if (!parsed || !parsed.isValid()) {
    return { raw: value, reason: INVALID, usable: false, e164: null };
  }
  return { e164: parsed.number, raw: value, usable: true };
}

/** What `Lead.phoneE164` stores for a raw phone: the E.164 form, or null. */
export function leadPhoneE164(raw: string | null | undefined): string | null {
  const normalised = normaliseLeadPhone(raw);
  return normalised.usable ? normalised.e164 : null;
}

/**
 * The E.164 form of a WhatsApp id (`wa_id`, `from`), or null.
 *
 * Meta sends the customer's number as bare digits with the country code. It
 * is not re-read as Australian: a `wa_id` always carries its country code, and
 * treating "61412…" as a local number would produce garbage.
 */
export function waIdToE164(waId: string | null | undefined): string | null {
  const digits = (waId ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  return parsed?.isValid() ? parsed.number : null;
}

/** "+61412345678" → "+61 412 345 678", for display only. */
export function formatE164ForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
