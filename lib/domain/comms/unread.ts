import { CallAnsweredBy, CommsDirection, type Prisma } from "@prisma/client";

import { authorizeLead, leadListScope } from "../access/leads";
import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";

// What "unread" means for a phone call and a text, once.
//
// The lead list's badge over the call icon, the leads page's "Pending
// Calls/Messages" badge and the commands that clear them all read these
// filters, so a count and the thing that clears it cannot drift apart.
//
// A text is unread until someone opens it: an inbound SMS with no `readAt`.
// A call is unread when it left something to look at — Mili spoke with the
// caller, or the caller left a voicemail — and nobody has opened it yet. An
// outbound call, or one a person answered, is never "unread": somebody was on
// it. Read state is shared, not per person: the office works on one or two
// shared logins, so "Sam read it" and "the office read it" are the same fact.

/** The answers that leave something for the office to read or hear. */
export const UNREAD_CALL_ANSWERS = [
  CallAnsweredBy.AGENT,
  CallAnsweredBy.VOICEMAIL,
] as const;

export const UNREAD_SMS_WHERE = {
  direction: CommsDirection.INBOUND,
  readAt: null,
} satisfies Prisma.SmsMessageWhereInput;

export const UNREAD_CALL_WHERE = {
  answeredBy: { in: [...UNREAD_CALL_ANSWERS] },
  direction: CommsDirection.INBOUND,
  seenAt: null,
} satisfies Prisma.CallWhereInput;

/** Whether one call counts as unread, for a record already in hand. */
export function isUnreadCall(call: {
  readonly direction: CommsDirection;
  readonly answeredBy: CallAnsweredBy | null;
  readonly seenAt: Date | null;
}): boolean {
  return (
    call.direction === CommsDirection.INBOUND
    && call.seenAt === null
    && call.answeredBy !== null
    && (UNREAD_CALL_ANSWERS as readonly CallAnsweredBy[]).includes(
      call.answeredBy,
    )
  );
}

export const MAX_UNREAD_LEADS = 200;

export type LeadCommsUnread = {
  readonly leadId: number;
  readonly calls: number;
  readonly sms: number;
};

/**
 * Unread calls and texts per lead, for the list's badge over the call icon.
 * Leads the caller may not list are left out rather than refused, the same as
 * the WhatsApp summaries beside it.
 */
export async function listLeadCommsUnread(
  principal: DomainPrincipal,
  input: { readonly leadIds: readonly number[] },
  db: DomainDb,
): Promise<LeadCommsUnread[]> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError("Call and SMS summaries are for staff.");
  }
  if (input.leadIds.length > MAX_UNREAD_LEADS) {
    throw new DomainValidationError(
      `Ask for at most ${MAX_UNREAD_LEADS} leads at a time.`,
      "leadIds",
    );
  }
  if (input.leadIds.length === 0) return [];
  const scope = leadListScope(principal);
  const leadWhere = {
    id: { in: [...input.leadIds] },
    ...(scope.assignedId ? { assignedId: scope.assignedId } : {}),
  } satisfies Prisma.LeadWhereInput;
  const [sms, calls] = await Promise.all([
    db.smsMessage.groupBy({
      _count: { _all: true },
      by: ["leadId"],
      where: { ...UNREAD_SMS_WHERE, lead: leadWhere },
    }),
    db.call.groupBy({
      _count: { _all: true },
      by: ["leadId"],
      where: { ...UNREAD_CALL_WHERE, lead: leadWhere },
    }),
  ]);
  const byLead = new Map<number, { calls: number; sms: number }>();
  const entry = (leadId: number) => {
    let found = byLead.get(leadId);
    if (!found) {
      found = { calls: 0, sms: 0 };
      byLead.set(leadId, found);
    }
    return found;
  };
  for (const row of sms) {
    if (row.leadId !== null) entry(row.leadId).sms = row._count._all;
  }
  for (const row of calls) {
    if (row.leadId !== null) entry(row.leadId).calls = row._count._all;
  }
  return [...byLead].map(([leadId, counts]) => ({ leadId, ...counts }));
}

/**
 * Mark a lead's unread calls and texts read, when someone opens its Phone &
 * SMS window. Returns how many of each changed.
 */
export async function markLeadCommsRead(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly at?: Date },
  db: DomainDb,
): Promise<{ calls: number; sms: number }> {
  await authorizeLead(principal, input.leadId, db);
  const at = input.at ?? new Date();
  const [sms, calls] = await Promise.all([
    db.smsMessage.updateMany({
      data: { readAt: at },
      where: { ...UNREAD_SMS_WHERE, leadId: input.leadId },
    }),
    db.call.updateMany({
      data: { seenAt: at },
      where: { ...UNREAD_CALL_WHERE, leadId: input.leadId },
    }),
  ]);
  return { calls: calls.count, sms: sms.count };
}
