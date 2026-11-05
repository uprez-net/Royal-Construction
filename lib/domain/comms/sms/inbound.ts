import {
  CommsDirection,
  SmsReviewStatus,
  SmsStatus,
  SmsUnmatchedReason,
} from "@prisma/client";

import type { TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { CommsChannel, CommsProviderName } from "../../ports/comms";
import type { DomainPrincipal } from "../../principal";
import {
  findBusinessNumber,
  isUniqueViolation,
  leadsWithNumber,
  maskNumber,
  providerColumn,
  recordCommsHistory,
} from "../shared";
import { isOptInMessage, isOptOutMessage } from "./policy";

// A customer's text arriving from a carrier.
//
// Reached from a public webhook after the adapter verified the carrier's
// signature. It never attaches a text to the nearest lead (a number that
// matches none, or several, waits for a person), never stores the same text
// twice (the provider id is unique), and never drops one.
//
// STOP is honoured before anything else: the lead's SMS opt-out is set in
// the same transaction that records the message (Spam Act 2003).

export type InboundSms = {
  readonly provider: CommsProviderName;
  readonly providerMessageId: string;
  /** Both E.164 by now: the adapter normalised them. */
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly mediaCount: number;
  readonly receivedAt: Date;
};

export type InboundSmsOutcome =
  | {
      readonly outcome: "attached";
      readonly leadId: number;
      readonly messageId: string;
      readonly optOut: "stopped" | "restarted" | null;
    }
  | {
      readonly outcome: "unmatched";
      readonly messageId: string;
      readonly reason: SmsUnmatchedReason;
    }
  | { readonly outcome: "duplicate" };

export function inboundSmsBody(body: string, mediaCount: number): string {
  const text = body.trim();
  if (mediaCount <= 0) return text || "[empty message]";
  const note = `[${mediaCount} attachment${mediaCount === 1 ? "" : "s"} — open the provider's message log to view]`;
  return text ? `${text}\n${note}` : note;
}

export async function recordInboundSms(
  principal: DomainPrincipal,
  input: InboundSms,
  db: TransactionalDomainDb,
  context: { readonly channel: CommsChannel | null },
): Promise<InboundSmsOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only a verified provider webhook may record an inbound text.",
    );
  }
  const provider = providerColumn(input.provider);
  const business = findBusinessNumber(context.channel, input.to, input.provider);
  const body = inboundSmsBody(input.body, input.mediaCount);

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.smsMessage.findUnique({
        select: { id: true },
        where: {
          provider_providerMessageId: {
            provider,
            providerMessageId: input.providerMessageId,
          },
        },
      });
      if (existing) return { outcome: "duplicate" as const };

      const candidates = business ? await leadsWithNumber(tx, input.from) : [];
      const base = {
        body,
        businessNumber: input.to,
        customerNumber: input.from,
        direction: CommsDirection.INBOUND,
        mediaCount: input.mediaCount,
        occurredAt: input.receivedAt,
        provider,
        providerMessageId: input.providerMessageId,
        status: SmsStatus.RECEIVED,
        statusAt: input.receivedAt,
      };

      if (!business || candidates.length !== 1) {
        const reason = !business
          ? SmsUnmatchedReason.UNKNOWN_BUSINESS_NUMBER
          : candidates.length === 0
            ? SmsUnmatchedReason.NO_MATCH
            : SmsUnmatchedReason.AMBIGUOUS;
        const message = await tx.smsMessage.create({
          data: {
            ...base,
            candidateLeadIds: candidates,
            reviewStatus: SmsReviewStatus.PENDING,
            unmatchedReason: reason,
          },
          select: { id: true },
        });
        // An unmatched STOP still stops every lead with that number: the
        // person asked, and not knowing which lead they are is no excuse.
        if (isOptOutMessage(input.body) && candidates.length > 0) {
          await tx.lead.updateMany({
            data: { smsOptedOutAt: input.receivedAt },
            where: { id: { in: candidates }, smsOptedOutAt: null },
          });
        }
        return { messageId: message.id, outcome: "unmatched" as const, reason };
      }

      const leadId = candidates[0];
      const lead = await tx.lead.findUnique({
        select: { smsOptedOutAt: true },
        where: { id: leadId },
      });
      let optOut: "stopped" | "restarted" | null = null;
      if (isOptOutMessage(input.body)) {
        optOut = "stopped";
        await tx.lead.update({
          data: { smsOptedOutAt: input.receivedAt },
          where: { id: leadId },
        });
      } else if (lead?.smsOptedOutAt && isOptInMessage(input.body)) {
        optOut = "restarted";
        await tx.lead.update({
          data: { smsOptedOutAt: null },
          where: { id: leadId },
        });
      }
      const message = await tx.smsMessage.create({
        data: { ...base, leadId },
        select: { id: true },
      });
      await recordCommsHistory(tx, {
        action:
          optOut === "stopped"
            ? "SMS opt-out"
            : optOut === "restarted"
              ? "SMS opt-in"
              : "SMS received",
        at: input.receivedAt,
        detail:
          optOut === "stopped"
            ? `${maskNumber(input.from)} texted STOP. No more texts will be sent to this lead.`
            : optOut === "restarted"
              ? `${maskNumber(input.from)} texted START and can be texted again.`
              : `Text received from ${maskNumber(input.from)} on ${business.label}.`,
        leadId,
        principal,
        type: "SMS",
      });
      return {
        leadId,
        messageId: message.id,
        optOut,
        outcome: "attached" as const,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "duplicate" };
    throw error;
  }
}
