import { CommsDirection, SmsReviewStatus, type Prisma } from "@prisma/client";

import { authorizeLead } from "../access/leads";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { isOfficePrincipal, type DomainPrincipal } from "../principal";
import { CALL_SELECT, toCallRecord, type CallRecord } from "./calls/records";
import { recordCommsHistory } from "./shared";
import {
  SMS_MESSAGE_SELECT,
  toSmsMessageRecord,
  type SmsMessageRecord,
} from "./sms/records";
import {
  UNREAD_CALL_ANSWERS,
  UNREAD_CALL_WHERE,
  UNREAD_SMS_WHERE,
} from "./unread";

// "Pending Calls/Messages" on the leads page: what came in on Royal's number
// from somebody no single lead owns, waiting for a person to file it.
//
//   - Calls Mili took, or that left a voicemail, from a number that matched no
//     lead (or more than one). A call nobody spoke on stays on the admin page
//     only: there is nothing in it to read.
//   - Texts in the SMS review queue (reviewStatus PENDING).
//
// Filing a call onto a lead sets its `leadId`; dismissing it sets
// `dismissedAt`. Either way it leaves the list. Texts are filed by
// `resolveUnmatchedSms`, which already owns that rule. The badge counts what
// is on the list and still unread (./unread), and opening the list marks
// exactly the items it showed as read — never one that arrived after.

const PENDING_LIMIT = 100;
const MAX_MARK_IDS = 200;

export const PENDING_CALL_WHERE = {
  answeredBy: { in: [...UNREAD_CALL_ANSWERS] },
  direction: CommsDirection.INBOUND,
  dismissedAt: null,
  leadId: null,
} satisfies Prisma.CallWhereInput;

export const PENDING_SMS_WHERE = {
  direction: CommsDirection.INBOUND,
  leadId: null,
  reviewStatus: SmsReviewStatus.PENDING,
} satisfies Prisma.SmsMessageWhereInput;

export type PendingComms = {
  readonly calls: readonly CallRecord[];
  readonly sms: readonly SmsMessageRecord[];
  /** Unread items on the list, for the button's badge. */
  readonly unread: number;
};

function requireStaff(principal: DomainPrincipal, what: string): void {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(`${what} is for members of staff.`);
  }
}

/** The pending list, newest first. */
export async function listPendingComms(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<PendingComms> {
  requireStaff(principal, "The pending calls and messages list");
  const [calls, sms, unread] = await Promise.all([
    db.call.findMany({
      orderBy: { startedAt: "desc" },
      select: CALL_SELECT,
      take: PENDING_LIMIT,
      where: PENDING_CALL_WHERE,
    }),
    db.smsMessage.findMany({
      orderBy: { occurredAt: "desc" },
      select: SMS_MESSAGE_SELECT,
      take: PENDING_LIMIT,
      where: PENDING_SMS_WHERE,
    }),
    countUnread(db),
  ]);
  return {
    calls: calls.map(toCallRecord),
    sms: sms.map(toSmsMessageRecord),
    unread,
  };
}

/** Just the badge number, for the button: two counts, no rows. */
export async function countPendingCommsUnread(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<number> {
  requireStaff(principal, "The pending calls and messages count");
  return countUnread(db);
}

async function countUnread(db: DomainDb): Promise<number> {
  const [calls, sms] = await Promise.all([
    db.call.count({ where: { ...PENDING_CALL_WHERE, ...UNREAD_CALL_WHERE } }),
    db.smsMessage.count({
      where: { ...PENDING_SMS_WHERE, ...UNREAD_SMS_WHERE },
    }),
  ]);
  return calls + sms;
}

/**
 * Mark the pending items someone has just been shown as read. Takes the ids
 * the list displayed, so a text that lands while the window is open still
 * counts as unread the next time.
 */
export async function markPendingCommsRead(
  principal: DomainPrincipal,
  input: {
    readonly callIds: readonly string[];
    readonly smsIds: readonly string[];
    readonly at?: Date;
  },
  db: DomainDb,
): Promise<{ calls: number; sms: number }> {
  requireStaff(principal, "Marking calls and messages read");
  if (input.callIds.length + input.smsIds.length > MAX_MARK_IDS) {
    throw new DomainValidationError(
      `Mark at most ${MAX_MARK_IDS} items at a time.`,
    );
  }
  const at = input.at ?? new Date();
  const [calls, sms] = await Promise.all([
    input.callIds.length > 0
      ? db.call.updateMany({
          data: { seenAt: at },
          where: {
            ...PENDING_CALL_WHERE,
            ...UNREAD_CALL_WHERE,
            id: { in: [...input.callIds] },
          },
        })
      : { count: 0 },
    input.smsIds.length > 0
      ? db.smsMessage.updateMany({
          data: { readAt: at },
          where: {
            ...PENDING_SMS_WHERE,
            ...UNREAD_SMS_WHERE,
            id: { in: [...input.smsIds] },
          },
        })
      : { count: 0 },
  ]);
  return { calls: calls.count, sms: sms.count };
}

/**
 * File a pending call onto a lead, or dismiss it. A person decides; a call is
 * never attached by guessing from the number.
 */
export async function resolvePendingCall(
  principal: DomainPrincipal,
  input:
    | {
        readonly callId: string;
        readonly action: "attach";
        readonly leadId: number;
      }
    | { readonly callId: string; readonly action: "dismiss" },
  db: TransactionalDomainDb,
): Promise<CallRecord> {
  if (!isOfficePrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Filing a call requires a signed-in member of staff.",
    );
  }
  const call = await db.call.findUnique({
    select: {
      answeredBy: true,
      direction: true,
      dismissedAt: true,
      id: true,
      leadId: true,
    },
    where: { id: input.callId },
  });
  if (!call) throw new DomainNotFoundError("Call not found");
  if (call.leadId !== null || call.dismissedAt !== null) {
    throw new DomainTransitionError("This call has already been filed.");
  }
  // Only what the pending list shows can be filed from it: an outbound call,
  // or one nobody spoke on, is not waiting for a person to decide.
  if (
    call.direction !== PENDING_CALL_WHERE.direction
    || !call.answeredBy
    || !(PENDING_CALL_WHERE.answeredBy.in as readonly string[]).includes(
      call.answeredBy,
    )
  ) {
    throw new DomainTransitionError(
      "Only calls on the pending list can be filed or dismissed here.",
    );
  }
  if (input.action === "attach") {
    await authorizeLead(principal, input.leadId, db);
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    // Conditional on still pending, so a second click or tab can't refile it.
    const claimed = await tx.call.updateMany({
      data:
        input.action === "attach"
          ? { leadId: input.leadId, seenAt: now }
          : { dismissedAt: now, dismissedById: principal.userId, seenAt: now },
      where: { ...PENDING_CALL_WHERE, id: call.id },
    });
    if (claimed.count !== 1) {
      throw new DomainTransitionError("This call has already been filed.");
    }
    if (input.action === "attach") {
      await recordCommsHistory(tx, {
        action: "Call filed",
        at: now,
        detail:
          "A call from an unrecognised number, taken by Mili or the voicemail, was filed onto this lead.",
        leadId: input.leadId,
        principal,
        type: "CALL",
      });
    }
    const updated = await tx.call.findUniqueOrThrow({
      select: CALL_SELECT,
      where: { id: call.id },
    });
    return toCallRecord(updated);
  });
}
