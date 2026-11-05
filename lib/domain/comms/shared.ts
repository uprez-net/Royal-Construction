import { CommsProvider, HistoryType } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";

import type { DomainDb } from "../db";
import type {
  CommsBusinessNumber,
  CommsChannel,
  CommsProviderName,
} from "../ports/comms";
import { attributionUserId, type DomainPrincipal } from "../principal";
import { DEFAULT_PHONE_REGION } from "../leads/whatsapp/phone";

// What SMS and calls share: the provider column, number normalisation, and
// the lead's history line. Pure apart from the history write.

const TO_ENUM: Record<CommsProviderName, CommsProvider> = {
  telnyx: CommsProvider.TELNYX,
  twilio: CommsProvider.TWILIO,
};

const FROM_ENUM: Record<CommsProvider, CommsProviderName> = {
  [CommsProvider.TELNYX]: "telnyx",
  [CommsProvider.TWILIO]: "twilio",
};

export function providerColumn(name: CommsProviderName): CommsProvider {
  return TO_ENUM[name];
}

export function providerName(column: CommsProvider): CommsProviderName {
  return FROM_ENUM[column];
}

/**
 * A number as a carrier reported it, in E.164, or null.
 *
 * Carriers disagree: Twilio sends "+61…", Plivo "61…", a WhatsApp-addressed
 * Twilio message "whatsapp:+61…", a browser leg "client:crm_…". A staff
 * identity is never a customer number, so `client:` and `sip:` answer null.
 * National AU numbers ("0412…") are read as Australian.
 */
export function carrierNumberToE164(
  raw: string | null | undefined,
): string | null {
  let value = (raw ?? "").trim();
  if (!value || /^(client|sip):/i.test(value)) return null;
  value = value.replace(/^(whatsapp|tel):/i, "").replace(/[\s()-]/g, "");
  if (/^00\d/.test(value)) value = `+${value.slice(2)}`;
  if (/^\d{8,15}$/.test(value) && !value.startsWith("0")) value = `+${value}`;
  const parsed = parsePhoneNumberFromString(value, DEFAULT_PHONE_REGION);
  return parsed?.isValid() ? parsed.number : null;
}

/** "+61412345678" → "+61412***678", for logs. Never log a whole number. */
export function maskNumber(e164: string | null | undefined): string {
  if (!e164) return "unknown";
  return e164.length > 7 ? `${e164.slice(0, 6)}***${e164.slice(-3)}` : "***";
}

/** The configured Royal number with this E.164, on this provider, if any. */
export function findBusinessNumber(
  channel: Pick<CommsChannel, "numbers"> | null,
  e164: string | null,
  provider?: CommsProviderName,
): CommsBusinessNumber | null {
  if (!channel || !e164) return null;
  return (
    channel.numbers.find(
      (number) =>
        number.e164 === e164 && (!provider || number.provider === provider),
    ) ?? null
  );
}

export async function recordCommsHistory(
  db: DomainDb,
  entry: {
    readonly leadId: number;
    readonly type: "SMS" | "CALL";
    readonly action: string;
    readonly detail: string;
    readonly at: Date;
    readonly principal: DomainPrincipal;
  },
): Promise<void> {
  const authorId = attributionUserId(entry.principal);
  await db.leadHistory.create({
    data: {
      action: entry.action,
      actionDate: entry.at,
      detail: entry.detail,
      leadId: entry.leadId,
      type: entry.type === "SMS" ? HistoryType.SMS : HistoryType.CALL,
      ...(authorId ? { authorId } : {}),
    },
  });
}

/** Leads with this E.164 number, enough of them to know if it is ambiguous. */
export async function leadsWithNumber(
  db: DomainDb,
  e164: string,
): Promise<number[]> {
  const leads = await db.lead.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
    take: 5,
    where: { phoneE164: e164 },
  });
  return leads.map((lead) => lead.id);
}
