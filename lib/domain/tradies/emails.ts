import { createHash } from "node:crypto";

import {
  CommsDirection,
  OutboxEventKind,
  TradieScheduleStatus,
} from "@prisma/client";

import { authorizeProject, canSeeProjectFinancials } from "../access/projects";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { DomainPrincipal } from "../principal";
import { AWAITING_TRADIE_REPLY, type TradieReplyReference } from "./replies";
import { subjectWithTradieRef, tradieRefKind } from "./reply-reference";

// One tradie's email thread on one project: what the office sent them, what
// they sent back, and a reply box.
//
// Before this, a tradie's answer was read for a status change and then thrown
// away. The office could see that a booking had moved to "awaiting admin
// approval" but not what the tradie actually wrote, and anything the model
// could not read — "Can do the 14th but not the 12th" — survived only as a
// notification sentence. With three people and no shared inbox habit, the
// email was the record and nobody could find it from the job.
//
// Two sources make up a thread:
//
//   - TradieRequestRecipient: each tradie's rendered copy of a quote or booking
//     request. Already stored, with its sent time, so it is read from there
//     rather than copied — and every request sent before this existed shows.
//   - TradieEmail: everything else, written where each email is sent or
//     received (reminders, reschedules, the week-out confirmation, replies
//     typed here or in Outlook, and the tradie's own messages).

/** What one row records. Pure data: callers say what was sent or received. */
export type TradieEmailInput = {
  readonly tradieId: string;
  readonly projectId: string | null;
  readonly scheduleId?: string | null;
  readonly direction: CommsDirection;
  readonly emailFrom?: string | null;
  readonly emailTo: string;
  readonly subject: string;
  readonly body: string;
  readonly refToken?: string | null;
  readonly graphMessageId?: string | null;
  readonly hasAttachments?: boolean;
  readonly sentAt: Date;
};

/**
 * Write one email onto the tradie's record.
 *
 * Idempotent on the Graph message id: the inbound webhook can be notified of
 * one message twice, and the sent-mail sync deliberately overlaps its previous
 * window. Returns whether a row was written.
 */
export async function recordTradieEmail(
  input: TradieEmailInput,
  db: DomainDb,
): Promise<boolean> {
  const created = await db.tradieEmail.createMany({
    data: [
      {
        body: input.body,
        direction: input.direction,
        emailFrom: input.emailFrom?.trim() || null,
        emailTo: input.emailTo.trim(),
        graphMessageId: input.graphMessageId || null,
        hasAttachments: input.hasAttachments ?? false,
        projectId: input.projectId,
        refToken: input.refToken ?? null,
        scheduleId: input.scheduleId ?? null,
        sentAt: input.sentAt,
        subject: input.subject,
        tradieId: input.tradieId,
      },
    ],
    skipDuplicates: true,
  });
  return created.count > 0;
}

/**
 * The same, beside a send that has already happened.
 *
 * The email is out; failing to file a copy of it must not turn into a failed
 * send that somebody retries into a second email. Logged at error level, which
 * reaches Sentry, so a thread that stops filling up is noticed.
 */
export async function noteTradieEmail(
  input: TradieEmailInput,
  db: DomainDb,
): Promise<void> {
  try {
    await recordTradieEmail(input, db);
  } catch (error) {
    console.error(
      `[tradie-email] Could not file an ${input.direction.toLowerCase()} email for tradie ${input.tradieId}`,
      error,
    );
  }
}

/**
 * Which project an unreferenced tradie message is about, when only one fits.
 *
 * A reply that quotes one of our references names its project. One that does
 * not — a fresh email, or a client that dropped the subject — is filed to the
 * project the tradie has open work on, if there is exactly one; failing that,
 * the one project they have ever been booked on. Anything else is left
 * unfiled rather than put on the wrong job's thread.
 */
export async function resolveUnreferencedTradieProject(
  tradieId: string,
  db: DomainDb,
): Promise<string | null> {
  const open = await db.tradieSchedule.findMany({
    distinct: ["projectId"],
    select: { projectId: true },
    take: 2,
    where: { status: { in: [...AWAITING_TRADIE_REPLY] }, tradieId },
  });
  if (open.length > 0) return open.length === 1 ? open[0].projectId : null;
  const ever = await db.tradieSchedule.findMany({
    distinct: ["projectId"],
    select: { projectId: true },
    take: 2,
    where: { status: { not: TradieScheduleStatus.CANCELLED }, tradieId },
  });
  return ever.length === 1 ? ever[0].projectId : null;
}

/** A message the tradie sent us, as the Graph webhook received it. */
export type InboundTradieEmail = {
  readonly tradieId: string;
  /** The reference the message quoted and what it resolved to, if any. */
  readonly reference: Pick<
    TradieReplyReference,
    "projectId" | "scope" | "token"
  > | null;
  readonly graphMessageId: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly hasAttachments: boolean;
  readonly receivedAt: Date;
};

/**
 * File a tradie's message on the project thread it belongs to.
 *
 * Separate from applying the reply to a booking, and called before it: the
 * status change can fail or be refused, and the message is still something
 * the tradie said.
 */
export async function recordInboundTradieEmail(
  input: InboundTradieEmail,
  db: DomainDb,
): Promise<{ readonly recorded: boolean; readonly projectId: string | null }> {
  const projectId = input.reference
    ? input.reference.projectId
    : await resolveUnreferencedTradieProject(input.tradieId, db);
  const scheduleId =
    input.reference && "scheduleId" in input.reference.scope
      ? input.reference.scope.scheduleId
      : null;
  const recorded = await recordTradieEmail(
    {
      body: input.body,
      direction: CommsDirection.INBOUND,
      emailFrom: input.from,
      emailTo: input.to,
      graphMessageId: input.graphMessageId,
      hasAttachments: input.hasAttachments,
      projectId,
      refToken: input.reference?.token ?? null,
      scheduleId,
      sentAt: Number.isNaN(input.receivedAt.getTime())
        ? new Date()
        : input.receivedAt,
      subject: input.subject,
      tradieId: input.tradieId,
    },
    db,
  );
  return { projectId, recorded };
}

export type TradieThreadMessage = {
  readonly id: string;
  readonly direction: CommsDirection;
  readonly subject: string;
  /** As sent or received: HTML for most, plain text for some. */
  readonly body: string;
  readonly emailFrom: string | null;
  readonly emailTo: string;
  readonly sentAt: Date;
  readonly hasAttachments: boolean;
  /** Where it came from: the request email, or any other message. */
  readonly source: "request" | "email";
};

export type TradieThread = {
  readonly projectId: string;
  readonly tradie: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  };
  /** Oldest first. */
  readonly messages: readonly TradieThreadMessage[];
  /** Why the office cannot reply here, or null when it can. */
  readonly replyBlockedBy: string | null;
};

/** Why a reply to this tradie cannot go, or null. The send re-checks it. */
function replyBlockedBy(tradie: {
  name: string;
  email: string;
  archivedAt: Date | null;
}): string | null {
  if (tradie.archivedAt) {
    return `${tradie.name} has been removed from the tradie directory.`;
  }
  if (!tradie.email.trim()) {
    return `${tradie.name} has no email address. Add one in the tradie directory.`;
  }
  return null;
}

/**
 * Who may read or write a tradie thread: whoever may see the project's money.
 *
 * The thread is quotes. A tradie answers "Yes, $4,800", a booking email
 * carries the agreed price, and free text cannot be redacted the way a
 * payload's amount fields are. A site manager is kept out of tradie quotes
 * everywhere else (`canSeeProjectFinancials`), so the thread follows that
 * rule rather than the wider "internal staff" one.
 */
function assertCanUseTradieThread(principal: DomainPrincipal): void {
  if (!canSeeProjectFinancials(principal)) {
    throw new DomainAuthorizationError(
      "Tradie emails carry quoted prices, so they are kept to the office.",
    );
  }
}

/** One tradie's thread on one project, for the Tradies tab. */
export async function getTradieProjectThread(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly tradieId: string },
  db: DomainDb,
): Promise<TradieThread> {
  assertCanUseTradieThread(principal);
  await authorizeProject(principal, input.projectId, db);
  const tradie = await db.tradie.findUnique({
    select: { archivedAt: true, email: true, id: true, name: true },
    where: { id: input.tradieId },
  });
  if (!tradie) throw new DomainNotFoundError("Tradie not found.");

  const [requests, emails] = await Promise.all([
    db.tradieRequestRecipient.findMany({
      select: {
        html: true,
        id: true,
        sentAt: true,
        subject: true,
        toAddress: true,
      },
      where: {
        request: { projectId: input.projectId },
        sentAt: { not: null },
        tradieId: input.tradieId,
      },
    }),
    db.tradieEmail.findMany({
      orderBy: { sentAt: "asc" },
      select: {
        body: true,
        direction: true,
        emailFrom: true,
        emailTo: true,
        hasAttachments: true,
        id: true,
        sentAt: true,
        subject: true,
      },
      where: { projectId: input.projectId, tradieId: input.tradieId },
    }),
  ]);

  const messages: TradieThreadMessage[] = [
    ...requests.map(
      (request): TradieThreadMessage => ({
        body: request.html,
        direction: CommsDirection.OUTBOUND,
        emailFrom: null,
        emailTo: request.toAddress,
        hasAttachments: false,
        id: `request:${request.id}`,
        // Filtered on above; the column is nullable for unsent copies.
        sentAt: request.sentAt as Date,
        source: "request",
        subject: request.subject,
      }),
    ),
    ...emails.map(
      (email): TradieThreadMessage => ({ ...email, source: "email" }),
    ),
  ].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  return {
    messages,
    projectId: input.projectId,
    replyBlockedBy: replyBlockedBy(tradie),
    tradie: { email: tradie.email, id: tradie.id, name: tradie.name },
  };
}

export type TradieThreadEmailPort = (input: {
  readonly to: string;
  readonly subject: string;
  /** HTML. */
  readonly body: string;
}) => Promise<void>;

/** The longest message the composer accepts. */
export const TRADIE_REPLY_MAX_LENGTH = 10_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A short, stable fingerprint of a typed message, for the outbox key. */
function bodyFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Plain text as typed, laid out as paragraphs. Exported for the test. */
export function tradieReplyHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}

/** "Re: Re: FW: x" → "x", so a long thread does not grow a prefix a reply. */
export function stripReplyPrefixes(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i, "").trim();
}

/**
 * Where a reply on this thread goes and what it is about.
 *
 * The subject carries the newest reference on the thread, so the tradie's
 * answer comes back matched to the same bookings rather than guessed from the
 * sender — which is the whole reason the references exist. It goes to the
 * address the tradie last wrote from, when that is one on their record: a
 * tradie whose office answers from accounts@ should hear back there.
 */
async function replyTarget(
  input: { readonly projectId: string; readonly tradieId: string },
  tradie: { email: string; additionalEmails: readonly string[] },
  projectName: string,
  db: DomainDb,
): Promise<{
  readonly to: string;
  readonly subject: string;
  readonly refToken: string | null;
  readonly scheduleId: string | null;
}> {
  const [lastEmail, lastReferenced, lastRequest, lastInbound] =
    await Promise.all([
      db.tradieEmail.findFirst({
        orderBy: { sentAt: "desc" },
        select: {
          refToken: true,
          scheduleId: true,
          sentAt: true,
          subject: true,
        },
        where: { projectId: input.projectId, tradieId: input.tradieId },
      }),
      // The newest email that carried a reference. A tradie's fresh message, or
      // a reply whose client dropped the subject, has none, and must not hand
      // the reference back to an older request when a newer email had one.
      db.tradieEmail.findFirst({
        orderBy: { sentAt: "desc" },
        select: { refToken: true, scheduleId: true, sentAt: true },
        where: {
          projectId: input.projectId,
          refToken: { not: null },
          tradieId: input.tradieId,
        },
      }),
      db.tradieRequestRecipient.findFirst({
        orderBy: { sentAt: "desc" },
        select: { refToken: true, sentAt: true, subject: true },
        where: {
          request: { projectId: input.projectId },
          sentAt: { not: null },
          tradieId: input.tradieId,
        },
      }),
      db.tradieEmail.findFirst({
        orderBy: { sentAt: "desc" },
        select: { emailFrom: true },
        where: {
          direction: CommsDirection.INBOUND,
          projectId: input.projectId,
          tradieId: input.tradieId,
        },
      }),
    ]);

  const newest =
    lastEmail
    && (!lastRequest?.sentAt || lastEmail.sentAt >= lastRequest.sentAt)
      ? lastEmail
      : lastRequest;

  let booking: { id: string; refToken: string | null } | null = null;
  if (!newest) {
    // Booked directly, before threads were recorded: nothing on the thread
    // yet, but the booking has its own reference.
    booking = await db.tradieSchedule.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, refToken: true },
      where: {
        projectId: input.projectId,
        status: { not: TradieScheduleStatus.CANCELLED },
        tradieId: input.tradieId,
      },
    });
    if (!booking) {
      throw new DomainTransitionError(
        "This tradie has not been asked about this project yet. Send a request from the Tradies tab first.",
      );
    }
  }

  // The newest reference on the thread, wherever it was carried. `newest`
  // still decides the subject and the recipient check above and below.
  const referencedRequest =
    lastRequest?.refToken && lastRequest.sentAt ? lastRequest : null;
  const newestReference =
    lastReferenced
    && (!referencedRequest?.sentAt
      || lastReferenced.sentAt >= referencedRequest.sentAt)
      ? lastReferenced
      : referencedRequest;
  const refToken = newestReference?.refToken ?? booking?.refToken ?? null;
  let scheduleId: string | null = booking?.id ?? null;
  if (!scheduleId && refToken && tradieRefKind(refToken) === "booking") {
    scheduleId =
      (lastReferenced?.refToken === refToken ? lastReferenced.scheduleId : null)
      ?? (
        await db.tradieSchedule.findUnique({
          select: { id: true },
          where: { refToken },
        })
      )?.id
      ?? null;
  }

  const base = stripReplyPrefixes(newest?.subject ?? "") || projectName;
  const known = [tradie.email, ...tradie.additionalEmails].map((address) =>
    address.trim().toLowerCase(),
  );
  const lastFrom = lastInbound?.emailFrom?.trim().toLowerCase();
  return {
    refToken,
    scheduleId,
    subject: subjectWithTradieRef(`Re: ${base}`, refToken),
    to: lastFrom && known.includes(lastFrom) ? lastFrom : tradie.email.trim(),
  };
}

export type TradieThreadReplyResult = {
  readonly to: string;
  readonly subject: string;
  /** This attempt had already gone; nothing was sent again. */
  readonly alreadySent: boolean;
};

/**
 * Send a message the office typed on a tradie's project thread.
 *
 * Keyed on the browser's attempt key: a double click or a retry after a
 * timeout is one email, a second reply somebody wrote is another. Nothing is
 * reported as sent unless Graph accepted it, and a replay says it is one.
 */
export async function replyOnTradieThread(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly tradieId: string;
    readonly body: string;
    readonly attemptKey: string;
    /** Overridable so a test does not depend on the wall clock. */
    readonly now?: Date;
  },
  db: DomainDb,
  send: TradieThreadEmailPort,
): Promise<TradieThreadReplyResult> {
  assertCanUseTradieThread(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const attemptKey = input.attemptKey.trim();
  if (!attemptKey) {
    throw new DomainValidationError(
      "Missing request key; close the thread and open it again.",
    );
  }
  const text = input.body.trim();
  if (!text) {
    throw new DomainValidationError("Write a message before sending.", "body");
  }
  if (text.length > TRADIE_REPLY_MAX_LENGTH) {
    throw new DomainValidationError(
      `Keep the message under ${TRADIE_REPLY_MAX_LENGTH.toLocaleString("en-AU")} characters.`,
      "body",
    );
  }

  const tradie = await db.tradie.findUnique({
    select: {
      additionalEmails: true,
      archivedAt: true,
      email: true,
      name: true,
    },
    where: { id: input.tradieId },
  });
  if (!tradie) throw new DomainNotFoundError("Tradie not found.");
  const blocked = replyBlockedBy(tradie);
  if (blocked) throw new DomainTransitionError(blocked);

  const target = await replyTarget(input, tradie, project.name, db);
  const body = tradieReplyHtml(text);
  const sentAt = input.now ?? new Date();

  let delivered = false;
  let replayed = false;
  try {
    ({ replayed } = await runOutboxEffectWithOutcome(
      db,
      {
        // The message is part of the key. A retry of the same text is the same
        // attempt and replays; text edited after a failed send is a new
        // message, and must not be answered "already sent" for an email that
        // never carried it.
        key: `tradie-thread-reply:${input.projectId}:${input.tradieId}:${attemptKey}:${bodyFingerprint(text)}`,
        kind: OutboxEventKind.TRADIE_THREAD_REPLY_SEND,
        payload: {
          projectId: input.projectId,
          subject: target.subject,
          to: target.to,
          tradieId: input.tradieId,
        },
      },
      async () => {
        await send({ body, subject: target.subject, to: target.to });
        delivered = true;
        // Filed here, before the outbox row is completed. Filed after it, a
        // failure between the two left a sent reply off the thread for good:
        // a replay of the key reports "already sent" and files nothing.
        // `noteTradieEmail` never throws, so the send is never reported as
        // failed over its copy, and a copy that cannot be written is logged
        // at error level, which reaches the office.
        await noteTradieEmail(
          {
            body,
            direction: CommsDirection.OUTBOUND,
            emailTo: target.to,
            projectId: input.projectId,
            refToken: target.refToken,
            scheduleId: target.scheduleId,
            sentAt,
            subject: target.subject,
            tradieId: input.tradieId,
          },
          db,
        );
        return { to: target.to };
      },
    ));
  } catch (error) {
    if (!delivered) {
      // The outbox refusing this key already says what to do.
      if (isDomainError(error) && !(error instanceof DomainSideEffectError)) {
        throw error;
      }
      // The outcome is unknown: Graph may have accepted a request whose answer
      // never came back. Say so, and leave the decision to resend to a person
      // who can look at Sent Items.
      throw new DomainSideEffectError(
        `The email to ${tradie.name} could not be confirmed as sent. Check Sent Items in Outlook before sending it again.`,
        "email",
        true,
        { cause: error },
      );
    }
    // Delivered, and already filed, but the outbox could not record its
    // outcome. A replay of this key is refused, not resent.
    console.error(
      `[tradie-email] Reply to tradie ${input.tradieId} was sent but its outbox row was not completed`,
      error,
    );
  }

  return { alreadySent: replayed, subject: target.subject, to: target.to };
}
