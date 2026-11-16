import { SmsReviewStatus } from "@prisma/client";

import { authorizeLead } from "../../access/leads";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../../errors";
import type { CommsChannel } from "../../ports/comms";
import { isInternalPrincipal, type DomainPrincipal } from "../../principal";
import { recordCommsHistory } from "../shared";
import { UNREAD_SMS_WHERE } from "../unread";
import { evaluateSmsEligibility, type SmsEligibility } from "./policy";
import {
  SMS_MESSAGE_SELECT,
  toSmsMessageRecord,
  type SmsMessageRecord,
} from "./records";

// Reads and small commands around a lead's SMS thread and the review queue.

export type LeadSmsThread = {
  readonly leadId: number;
  readonly messages: readonly SmsMessageRecord[];
  readonly eligibility: Pick<
    SmsEligibility,
    "allowed" | "reason" | "optedOut"
  > & {
    readonly to: string | null;
    readonly from: string | null;
    readonly fromLabel: string | null;
  };
  readonly hasOlder: boolean;
};

const THREAD_PAGE = 50;

export async function getLeadSmsThread(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly before?: Date | null },
  db: DomainDb,
  context: { readonly channel: CommsChannel | null },
): Promise<LeadSmsThread> {
  await authorizeLead(principal, input.leadId, db);
  const lead = await db.lead.findUnique({
    select: { isArchived: true, phone: true, smsOptedOutAt: true },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  const rows = await db.smsMessage.findMany({
    orderBy: { occurredAt: "desc" },
    select: SMS_MESSAGE_SELECT,
    take: THREAD_PAGE + 1,
    where: {
      leadId: input.leadId,
      ...(input.before ? { occurredAt: { lt: input.before } } : {}),
    },
  });
  const eligibility = evaluateSmsEligibility({
    channel: context.channel,
    lead,
  });
  return {
    eligibility: {
      allowed: eligibility.allowed,
      from: eligibility.sender?.e164 ?? null,
      fromLabel: eligibility.sender?.label ?? null,
      optedOut: eligibility.optedOut,
      reason: eligibility.reason,
      to: eligibility.phone.e164,
    },
    hasOlder: rows.length > THREAD_PAGE,
    leadId: input.leadId,
    messages: rows.slice(0, THREAD_PAGE).reverse().map(toSmsMessageRecord),
  };
}

/** Mark a lead's inbound texts read. Returns how many changed. */
export async function markLeadSmsRead(
  principal: DomainPrincipal,
  input: { readonly leadId: number },
  db: DomainDb,
): Promise<number> {
  await authorizeLead(principal, input.leadId, db);
  const result = await db.smsMessage.updateMany({
    data: { readAt: new Date() },
    where: { ...UNREAD_SMS_WHERE, leadId: input.leadId },
  });
  return result.count;
}

// ── The review queue ──────────────────────────────────────────────────

export async function listUnmatchedSms(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<SmsMessageRecord[]> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError("The SMS review queue is for staff.");
  }
  const rows = await db.smsMessage.findMany({
    orderBy: { occurredAt: "desc" },
    select: SMS_MESSAGE_SELECT,
    take: 100,
    where: { reviewStatus: SmsReviewStatus.PENDING },
  });
  return rows.map(toSmsMessageRecord);
}

/**
 * File an unmatched text onto a lead, or dismiss it. A person decides; the
 * texts are never attached by guess.
 */
export async function resolveUnmatchedSms(
  principal: DomainPrincipal,
  input:
    | {
        readonly messageId: string;
        readonly action: "attach";
        readonly leadId: number;
      }
    | { readonly messageId: string; readonly action: "dismiss" },
  db: TransactionalDomainDb,
): Promise<SmsMessageRecord> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Filing a text requires a signed-in member of staff.",
    );
  }
  const message = await db.smsMessage.findUnique({
    select: { id: true, reviewStatus: true },
    where: { id: input.messageId },
  });
  if (!message) throw new DomainNotFoundError("Message not found");
  if (message.reviewStatus !== SmsReviewStatus.PENDING) {
    throw new DomainTransitionError("This text has already been filed.");
  }
  if (input.action === "attach") {
    await authorizeLead(principal, input.leadId, db);
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    // Conditional on PENDING, so a second click or tab can't refile it.
    const claimed = await tx.smsMessage.updateMany({
      data:
        input.action === "attach"
          ? {
              leadId: input.leadId,
              resolvedAt: now,
              resolvedById: principal.userId,
              reviewStatus: SmsReviewStatus.ATTACHED,
            }
          : {
              resolvedAt: now,
              resolvedById: principal.userId,
              reviewStatus: SmsReviewStatus.DISMISSED,
            },
      where: { id: message.id, reviewStatus: SmsReviewStatus.PENDING },
    });
    if (claimed.count !== 1) {
      throw new DomainTransitionError("This text has already been filed.");
    }
    if (input.action === "attach") {
      await recordCommsHistory(tx, {
        action: "SMS filed",
        at: now,
        detail: "A text from an unrecognised number was filed onto this lead.",
        leadId: input.leadId,
        principal,
        type: "SMS",
      });
    }
    const updated = await tx.smsMessage.findUniqueOrThrow({
      select: SMS_MESSAGE_SELECT,
      where: { id: message.id },
    });
    return toSmsMessageRecord(updated);
  });
}
