import {
  MilestoneStatus,
  OutboxEventKind,
  Prisma,
  TradieRequestDeliveryStatus,
  TradieRequestKind,
  TradieScheduleStatus,
  type ProjectStage,
} from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../principal";
import { assertCanBookTradies, authorizeProject } from "../access/projects";
import { runOutboxEffectWithOutcome } from "../outbox";
import {
  noteTradieActivity,
  recordTradieActivity,
  viaOf,
} from "../audit/tradie-activity-log";
import type {
  TradieRequestAiPort,
  WorkDetailsDraft,
} from "../ports/tradie-request-ai";
import { INACTIVE_SCHEDULE_STATUSES, requireBookableTradie } from "./lifecycle";
import {
  generateTradieRefToken,
  subjectWithTradieRef,
} from "./reply-reference";
import {
  canRetryRequestEmail,
  deliveryAfterFailure,
  type RequestSendFailure,
} from "./request-delivery";
import {
  activityAcceptsTrade,
  bookingTrade,
  isRequestableMilestone,
  isRequestAttachable,
  MAX_REQUEST_ACTIVITIES,
  MAX_REQUEST_ATTACHMENT_BYTES,
  MAX_REQUEST_ATTACHMENTS,
  MAX_REQUEST_TRADIES,
  tradeList,
  tradieCoversTrade,
  tradieTradeLabel,
  tradieTrades,
} from "./request-rules";
import { createTradieSchedules, type CreatedSchedule } from "./schedules";
import {
  bookingsDisplacedBySelection,
  directBookingRefusal,
  LIVE_SELECTION_STATUSES,
  tradeKey,
} from "./selection-rules";

// A tradie request: one trade, several of the project's activities, sent to
// one or more companies so their quotes can be compared.
//
// Each company gets ONE email covering every activity. The bulk booking this
// replaced looked up a row's email by tradie, so a tradie booked onto three
// milestones received the same email three times.
//
// What the command refuses, beyond what `createTradieSchedule` already does
// for every booking (the same booking twice, a milestone on another project):
//
//   - An activity that is finished or waived. The picker hid them; nothing
//     stopped a caller sending one.
//   - Companies from different trades, or an activity whose build sequence
//     names a different trade. The email tells the tradie which trade they are
//     quoting for, so a plumber asked to price electrical work is a wrong
//     message in front of someone outside the office.
//   - A company with no email address. The request IS the email, so saving
//     the bookings and sending nothing would report a request nobody received.
//
// A request is one of two kinds (`TradieRequestKind`):
//
//   - QUOTE: one or more companies are asked to price the work, and their
//     bookings wait on a quote until one is selected.
//   - BOOKING: the office has already chosen the company. Exactly one tradie;
//     the email asks only that they confirm the dates, the bookings start
//     PENDING rather than AWAITING_QUOTE, and the trade selection a chosen
//     quote would have made is made now — so the same rules stop it
//     (`directBookingRefusal`) and the same other tradies' open requests on
//     those activities are cancelled. A price can be recorded later.
//
// Each company's copy carries its own reference (`reply-reference.ts`) in the
// subject and the body, so the tradie's reply is matched to the bookings that
// email asked about instead of being guessed from the sender.
//
// The request, each company's copy of the email and the bookings are written
// in one transaction. Then each email is sent as its own attempt, and where it
// stands — sent, retrying, failed — is stored on the copy, so a failure stays
// on screen with a Retry button instead of living only in a toast. Retrying
// resends the stored email, not a re-render, so it is what was reviewed.

export type TradieRequestActivityInput = {
  readonly milestoneId: string;
  /** Approximate first day; the email says so. */
  readonly scheduledDate: Date;
  readonly durationDays: number;
};

export type SendTradieRequestsInput = {
  /** QUOTE when omitted. */
  readonly kind?: TradieRequestKind;
  /**
   * The trade the request is for. A tradie can work in several, so it cannot
   * be read off them; omitted, it is the first tradie's primary trade.
   */
  readonly trade?: string;
  readonly projectId: string;
  readonly tradieIds: readonly string[];
  readonly activities: readonly TradieRequestActivityInput[];
  readonly subject: string;
  readonly note?: string | null;
  /**
   * Project files every copy of the email carries, in the order picked: files
   * already on the project, or ones uploaded to it from the wizard.
   */
  readonly attachmentFileIds?: readonly string[];
};

/** A file a request email carries, as the mail adapter needs it to attach. */
export type TradieRequestAttachment = {
  readonly filename: string;
  readonly url: string;
  readonly fileType: string;
};

export type TradieRequestActivity = {
  readonly milestoneId: string;
  readonly name: string;
  readonly projectStage: ProjectStage;
  readonly scheduledDate: Date;
  readonly durationDays: number;
};

/** Renders one company's email. Pure: no sending. */
export type TradieRequestRenderPort = (message: {
  readonly kind: TradieRequestKind;
  /** This tradie's copy's reference; the template shows it in the body. */
  readonly reference: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly trade: string;
  readonly subject: string;
  readonly tradieName: string;
  readonly activities: readonly TradieRequestActivity[];
}) => { readonly subject: string; readonly html: string };

export type TradieRequestMailPorts = {
  /** Sends one stored email. Throws when the mail server did not accept it. */
  readonly send: (email: {
    readonly to: string;
    readonly cc: readonly string[];
    readonly subject: string;
    readonly html: string;
    readonly attachments: readonly TradieRequestAttachment[];
  }) => Promise<void>;
  /** What a thrown send means: see `RequestSendFailure`. */
  readonly classifyFailure: (error: unknown) => RequestSendFailure;
};

export type TradieRequestDelivery = {
  readonly recipientId: string;
  readonly tradieId: string;
  readonly tradieName: string;
  readonly to: string;
  readonly status: TradieRequestDeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  /** Why it is not sent, when it is not. Operator-facing. */
  readonly reason: string | null;
};

export type SentTradieRequests = {
  readonly requestId: string;
  readonly kind: TradieRequestKind;
  readonly trade: string;
  readonly schedules: readonly CreatedSchedule[];
  readonly deliveries: readonly TradieRequestDelivery[];
  /** A direct booking: other tradies' open bookings it cancelled. */
  readonly cancelled: readonly {
    readonly scheduleId: string;
    readonly tradieName: string;
    readonly milestoneName: string | null;
  }[];
};

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

function assertDistinct(ids: readonly string[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new DomainValidationError(`The same ${what} is listed twice.`);
  }
}

/**
 * Takes the client, not a transaction: the command owns its transaction
 * because the emails go out after it commits. Inside a caller's transaction
 * they would be sent for bookings that could still roll back.
 */
export async function sendTradieRequests(
  principal: DomainPrincipal,
  input: SendTradieRequestsInput,
  db: TransactionalDomainDb,
  ports: TradieRequestMailPorts & { readonly render: TradieRequestRenderPort },
): Promise<SentTradieRequests> {
  assertCanBookTradies(principal);
  if (input.tradieIds.length === 0) {
    throw new DomainValidationError("Choose at least one tradie.", "tradieIds");
  }
  if (input.activities.length === 0) {
    throw new DomainValidationError(
      "Choose at least one activity.",
      "activities",
    );
  }
  if (input.tradieIds.length > MAX_REQUEST_TRADIES) {
    throw new DomainValidationError(
      `A request can go to at most ${MAX_REQUEST_TRADIES} tradies at once.`,
      "tradieIds",
    );
  }
  if (input.activities.length > MAX_REQUEST_ACTIVITIES) {
    throw new DomainValidationError(
      `A request can cover at most ${MAX_REQUEST_ACTIVITIES} activities.`,
      "activities",
    );
  }
  const kind = input.kind ?? TradieRequestKind.QUOTE;
  const booking = kind === TradieRequestKind.BOOKING;
  if (booking && input.tradieIds.length !== 1) {
    throw new DomainValidationError(
      "Book one tradie at a time. To compare prices from several, send a quote request instead.",
      "tradieIds",
    );
  }
  if (!input.subject.trim()) {
    throw new DomainValidationError("Give the email a subject.", "subject");
  }
  assertDistinct(input.tradieIds, "tradie");
  assertDistinct(
    input.activities.map((activity) => activity.milestoneId),
    "activity",
  );
  const attachmentFileIds = [...(input.attachmentFileIds ?? [])];
  assertDistinct(attachmentFileIds, "attachment");
  if (attachmentFileIds.length > MAX_REQUEST_ATTACHMENTS) {
    throw new DomainValidationError(
      `A request can carry at most ${MAX_REQUEST_ATTACHMENTS} attachments.`,
      "attachmentFileIds",
    );
  }
  for (const activity of input.activities) {
    if (!Number.isInteger(activity.durationDays) || activity.durationDays < 1) {
      throw new DomainValidationError(
        "Each activity needs a duration of at least one day.",
        "durationDays",
      );
    }
  }

  const project = await authorizeProject(principal, input.projectId, db);

  const tradies: Awaited<ReturnType<typeof requireBookableTradie>>[] = [];
  for (const tradieId of input.tradieIds) {
    tradies.push(await requireBookableTradie(tradieId, db));
  }
  const asked = input.trade?.trim() || tradies[0].trade.trim();
  const trade = tradieTradeLabel(tradies[0], asked) ?? asked;
  const otherTrade = tradies.find(
    (tradie) => !tradieCoversTrade(tradie, trade),
  );
  if (otherTrade) {
    throw new DomainValidationError(
      `${otherTrade.name} is listed under ${tradieTrades(otherTrade).join(", ") || "no trade"}, not ${trade}. Send each trade as its own request.`,
      "tradieIds",
    );
  }
  const unreachable = tradies.find((tradie) => !tradie.email.trim());
  if (unreachable) {
    throw new DomainValidationError(
      `${unreachable.name} has no email address. Add one in the tradie directory before sending a request.`,
      "tradieIds",
    );
  }

  if (attachmentFileIds.length > 0) {
    const files = await db.file.findMany({
      select: { filesize: true, id: true, incidentId: true },
      where: { id: { in: attachmentFileIds }, projectId: project.id },
    });
    // Every one, or the request is refused: an email that goes out short of a
    // file the office picked reads to the tradie as the whole package.
    if (
      files.length !== attachmentFileIds.length
      || !files.every(isRequestAttachable)
    ) {
      throw new DomainNotFoundError(
        "One of the attachments is not a file on this project. Remove it and pick it again.",
      );
    }
    const bytes = files.reduce((total, file) => total + file.filesize, 0);
    if (bytes > MAX_REQUEST_ATTACHMENT_BYTES) {
      throw new DomainValidationError(
        `The attachments come to ${megabytes(bytes)} MB; one email can carry ${megabytes(MAX_REQUEST_ATTACHMENT_BYTES)} MB. Remove some, or put a link to the larger files in the note.`,
        "attachmentFileIds",
      );
    }
  }

  const milestones = await db.milestone.findMany({
    select: {
      id: true,
      name: true,
      projectStage: true,
      requiredTradeTypes: { select: { label: true } },
      status: true,
    },
    where: {
      id: { in: input.activities.map((activity) => activity.milestoneId) },
      projectId: project.id,
    },
  });
  const milestoneById = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );

  const activities: TradieRequestActivity[] = input.activities.map(
    (activity) => {
      const milestone = milestoneById.get(activity.milestoneId);
      if (!milestone) {
        throw new DomainNotFoundError(
          "One of the activities is not on this project.",
        );
      }
      if (!isRequestableMilestone(milestone.status)) {
        throw new DomainValidationError(
          `${milestone.name} is already ${milestone.status === MilestoneStatus.DONE ? "done" : "marked not required"}, so it cannot be requested.`,
          "activities",
        );
      }
      if (!activityAcceptsTrade(milestone.requiredTradeTypes, trade)) {
        throw new DomainValidationError(
          `${milestone.name} needs ${tradeList(milestone.requiredTradeTypes)}, not ${trade}.`,
          "activities",
        );
      }
      return {
        durationDays: activity.durationDays,
        milestoneId: milestone.id,
        name: milestone.name,
        projectStage: milestone.projectStage,
        scheduledDate: activity.scheduledDate,
      };
    },
  );

  // Rendered before the transaction: it is pure, and what is stored is what
  // is sent, now and on every retry. The reference goes on the subject here,
  // whatever the template did, because the reply is matched on it.
  const emails = tradies.map((tradie) => {
    const refToken = generateTradieRefToken("request");
    const rendered = ports.render({
      activities,
      kind,
      project: { id: project.id, name: project.name },
      reference: refToken,
      subject: input.subject.trim(),
      trade,
      tradieName: tradie.name,
    });
    return {
      html: rendered.html,
      refToken,
      subject: subjectWithTradieRef(rendered.subject, refToken),
      tradie,
    };
  });

  const write = async (tx: DomainDb) => {
    // Refused before anything is written: a direct booking takes the trade.
    const claim = booking
      ? await claimTradeForBooking(
          {
            milestoneIds: activities.map((activity) => activity.milestoneId),
            projectId: project.id,
            trade,
            tradie: tradies[0],
          },
          tx,
        )
      : null;

    const request = await tx.tradieRequest.create({
      data: {
        attachmentFileIds,
        createdById: attributionUserId(principal),
        kind,
        note: input.note?.trim() || null,
        projectId: project.id,
        subject: input.subject.trim(),
        trade,
      },
      select: { id: true },
    });
    const recipients: { id: string; tradieId: string }[] = [];
    for (const email of emails) {
      recipients.push(
        await tx.tradieRequestRecipient.create({
          data: {
            ccAddresses: email.tradie.additionalEmails,
            html: email.html,
            refToken: email.refToken,
            requestId: request.id,
            subject: email.subject,
            toAddress: email.tradie.email.trim(),
            tradieId: email.tradie.id,
          },
          select: { id: true, tradieId: true },
        }),
      );
    }
    const recipientByTradie = new Map(
      recipients.map((recipient) => [recipient.tradieId, recipient.id]),
    );
    // Every booking or none: the same command and checks as a single booking.
    const schedules = await createTradieSchedules(
      principal,
      tradies.flatMap((tradie) =>
        activities.map((activity) => ({
          durationDays: activity.durationDays,
          milestoneId: activity.milestoneId,
          projectId: project.id,
          requestRecipientId: recipientByTradie.get(tradie.id) ?? null,
          requiresQuote: !booking,
          scheduledDate: activity.scheduledDate,
          trade,
          tradieId: tradie.id,
        })),
      ),
      tx,
    );

    if (claim) {
      if (claim.displaced.length > 0) {
        await tx.tradieSchedule.updateMany({
          data: { status: TradieScheduleStatus.CANCELLED },
          where: {
            id: { in: claim.displaced.map((displaced) => displaced.id) },
            status: { notIn: INACTIVE_SCHEDULE_STATUSES },
          },
        });
      }
      for (const displaced of claim.displaced) {
        await recordTradieActivity(
          {
            data: {
              milestoneId: displaced.milestoneId,
              projectId: project.id,
              reason: `${tradies[0].name} was booked directly for ${trade}`,
              scheduleId: displaced.id,
              tradieId: displaced.tradieId,
            },
            principal,
            type: "bookingCancelled",
          },
          tx,
        );
      }
      // Already theirs when this adds activities to a tradie selected before.
      if (!claim.selected) {
        await tx.tradeSelection.create({
          data: {
            projectId: project.id,
            selectedById: attributionUserId(principal),
            trade,
            tradeKey: tradeKey(trade),
            tradieId: tradies[0].id,
          },
          select: { id: true },
        });
        await recordTradieActivity(
          {
            data: {
              fromQuote: false,
              projectId: project.id,
              trade,
              tradieId: tradies[0].id,
            },
            principal,
            type: "selectedForTrade",
          },
          tx,
        );
      }
    }
    return {
      cancelled: (claim?.displaced ?? []).map((displaced) => ({
        milestoneName: displaced.milestoneName,
        scheduleId: displaced.id,
        tradieName: displaced.tradieName,
      })),
      recipients,
      requestId: request.id,
      schedules,
    };
  };
  const written = await db.$transaction(write, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });

  const deliveries: TradieRequestDelivery[] = [];
  for (const recipient of written.recipients) {
    deliveries.push(
      await deliverTradieRequest(
        principal,
        { recipientId: recipient.id, trigger: "initial" },
        db,
        ports,
      ),
    );
  }

  return {
    cancelled: written.cancelled,
    deliveries,
    kind,
    requestId: written.requestId,
    schedules: written.schedules,
    trade,
  };
}

/**
 * Whether this tradie may take the trade by being booked directly, and what
 * that cancels. Read inside the request's transaction, before it writes.
 */
async function claimTradeForBooking(
  input: {
    readonly projectId: string;
    readonly trade: string;
    readonly tradie: { readonly id: string; readonly name: string };
    readonly milestoneIds: readonly string[];
  },
  tx: DomainDb,
): Promise<{
  /** The tradie already holds the trade's live selection. */
  readonly selected: boolean;
  readonly displaced: readonly {
    readonly id: string;
    readonly tradieId: string;
    readonly tradieName: string;
    readonly milestoneId: string | null;
    readonly milestoneName: string | null;
  }[];
}> {
  const live = await tx.tradeSelection.findFirst({
    select: {
      status: true,
      tradie: { select: { name: true } },
      tradieId: true,
    },
    where: {
      projectId: input.projectId,
      status: { in: [...LIVE_SELECTION_STATUSES] },
      tradeKey: tradeKey(input.trade),
    },
  });
  const rows = await tx.tradieSchedule.findMany({
    select: {
      id: true,
      milestone: { select: { name: true } },
      milestoneId: true,
      quotedPrice: true,
      status: true,
      trade: true,
      tradie: { select: { name: true, trade: true } },
      tradieId: true,
    },
    where: { projectId: input.projectId, tradieId: { not: input.tradie.id } },
  });
  const others = rows.map((row) => ({
    id: row.id,
    tradieId: row.tradieId,
    milestoneId: row.milestoneId,
    milestoneName: row.milestone?.name ?? null,
    quotedPrice: row.quotedPrice,
    status: row.status,
    trade: bookingTrade(row),
    tradieName: row.tradie.name,
  }));

  const refusal = directBookingRefusal({
    liveSelection: live
      ? {
          status: live.status,
          tradieId: live.tradieId,
          tradieName: live.tradie.name,
        }
      : null,
    milestoneIds: input.milestoneIds,
    others,
    trade: input.trade,
    tradieId: input.tradie.id,
    tradieName: input.tradie.name,
  });
  if (refusal) {
    throw refusal.kind === "validation"
      ? new DomainValidationError(refusal.message)
      : new DomainTransitionError(refusal.message);
  }

  return {
    displaced: bookingsDisplacedBySelection(
      input.milestoneIds.map((milestoneId) => ({
        milestoneId,
        status: TradieScheduleStatus.PENDING,
      })),
      others,
      input.trade,
    ),
    selected: live !== null,
  };
}

const WITHDRAWN_REQUEST_EMAIL =
  "Not sent: every booking this email asked about has since been cancelled.";

const MISSING_ATTACHMENT_EMAIL =
  "Not sent: a file attached to this email has since been deleted from the project, so it cannot go out as it was reviewed.";

/**
 * Make one attempt at one tradie's request email, and record where it stands.
 *
 * - `initial`: the first send, straight after the request was written.
 * - `automatic`: a scheduled retry, run by the retry workflow as the system.
 * - `manual`: a person pressed Retry. Allowed once the email has failed, or
 *   when a scheduled retry is overdue (`canRetryRequestEmail`).
 *
 * The attempt is claimed with a conditional update on the status and attempt
 * count it was decided from, so a double-click, a workflow step that runs
 * twice, or a person and the workflow at the same moment make one attempt,
 * not two. The send itself goes through the outbox under a key per attempt.
 *
 * A send that fails is an answer, not an exception: it is recorded and
 * returned. Only a refusal to attempt at all throws.
 */
export async function deliverTradieRequest(
  principal: DomainPrincipal,
  input: {
    readonly recipientId: string;
    readonly trigger: "initial" | "automatic" | "manual";
    /** For a manual retry: the project the screen showed it under. */
    readonly projectId?: string;
    readonly now?: Date;
  },
  db: DomainDb,
  ports: TradieRequestMailPorts,
): Promise<TradieRequestDelivery> {
  const now = input.now ?? new Date();
  const recipient = await db.tradieRequestRecipient.findUnique({
    select: {
      attempts: true,
      ccAddresses: true,
      createdAt: true,
      deliveryStatus: true,
      html: true,
      id: true,
      lastAttemptAt: true,
      lastError: true,
      nextAttemptAt: true,
      request: { select: { attachmentFileIds: true, projectId: true } },
      subject: true,
      toAddress: true,
      tradie: { select: { archivedAt: true, name: true } },
      tradieId: true,
    },
    where: { id: input.recipientId },
  });
  if (!recipient) throw new DomainNotFoundError("Request email not found.");

  const describe = (state: {
    readonly attempts: number;
    readonly deliveryStatus: TradieRequestDeliveryStatus;
    readonly lastError: string | null;
    readonly nextAttemptAt: Date | null;
  }): TradieRequestDelivery => ({
    attempts: state.attempts,
    nextAttemptAt: state.nextAttemptAt,
    reason:
      state.deliveryStatus === TradieRequestDeliveryStatus.SENT
        ? null
        : state.lastError,
    recipientId: recipient.id,
    status: state.deliveryStatus,
    to: recipient.toAddress,
    tradieId: recipient.tradieId,
    tradieName: recipient.tradie.name,
  });

  switch (input.trigger) {
    case "initial":
      assertCanBookTradies(principal);
      if (
        recipient.deliveryStatus !== TradieRequestDeliveryStatus.SENDING
        || recipient.attempts !== 0
      ) {
        return describe(recipient);
      }
      break;
    case "automatic":
      if (!isInternalPrincipal(principal)) {
        throw new DomainTransitionError("Automatic retries run as the system.");
      }
      // Not due, or no longer waiting: someone retried by hand, or a step ran
      // twice. Nothing to do.
      if (
        recipient.deliveryStatus !== TradieRequestDeliveryStatus.RETRYING
        || !recipient.nextAttemptAt
        || recipient.nextAttemptAt.getTime() > now.getTime()
      ) {
        return describe(recipient);
      }
      break;
    case "manual": {
      assertCanBookTradies(principal);
      const project = await authorizeProject(
        principal,
        recipient.request.projectId,
        db,
      );
      if (input.projectId && input.projectId !== project.id) {
        throw new DomainNotFoundError("Request email not found.");
      }
      if (recipient.tradie.archivedAt) {
        throw new DomainTransitionError(
          "This tradie has been removed from the directory, so the request cannot be resent.",
        );
      }
      if (!canRetryRequestEmail(recipient, now)) {
        throw new DomainTransitionError(
          recipient.deliveryStatus === TradieRequestDeliveryStatus.SENT
            ? "This email has already been sent."
            : recipient.deliveryStatus === TradieRequestDeliveryStatus.RETRYING
              ? "This email is already scheduled to be retried automatically."
              : "This email is being sent right now.",
        );
      }
      break;
    }
  }

  // Every booking this email asked about may have been cancelled since — by a
  // direct booking or a selected quote taking the activities, a cancelled
  // trade, a settled milestone. Checked here, the one door every send goes
  // through, rather than at each of those: an email about work that is no
  // longer offered must not reach the tradie, by robot or by Retry. The
  // initial send is exempt: its bookings were written in the same request.
  //
  // Not sending is terminal: FAILED with no next attempt, so the retry
  // workflow stops. A person pressing Retry is told why instead.
  const notSent = async (reason: string): Promise<TradieRequestDelivery> => {
    if (input.trigger === "manual") throw new DomainTransitionError(reason);
    await noteDelivery(
      principal,
      recipient,
      { attempt: recipient.attempts, reason },
      db,
    );
    const stopped = {
      deliveryStatus: TradieRequestDeliveryStatus.FAILED,
      lastError: reason,
      nextAttemptAt: null,
    };
    await db.tradieRequestRecipient.updateMany({
      data: stopped,
      where: {
        attempts: recipient.attempts,
        deliveryStatus: recipient.deliveryStatus,
        id: recipient.id,
      },
    });
    return describe({ ...stopped, attempts: recipient.attempts });
  };
  if (input.trigger !== "initial") {
    const open = await db.tradieSchedule.count({
      where: {
        requestRecipientId: recipient.id,
        status: { notIn: INACTIVE_SCHEDULE_STATUSES },
      },
    });
    // No alert follows — attention skips emails on closed bookings.
    if (open === 0) return notSent(WITHDRAWN_REQUEST_EMAIL);
  }

  // Read again on every attempt, from the ids stored with the request:
  // retrying resends what was reviewed, so a file deleted since stops the send
  // rather than letting it go out a file short.
  const attachmentFileIds = recipient.request.attachmentFileIds ?? [];
  const attachments: TradieRequestAttachment[] = [];
  if (attachmentFileIds.length > 0) {
    const files = await db.file.findMany({
      select: { fileType: true, filename: true, id: true, url: true },
      where: {
        id: { in: [...attachmentFileIds] },
        projectId: recipient.request.projectId,
      },
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    for (const id of attachmentFileIds) {
      const file = byId.get(id);
      if (!file) return notSent(MISSING_ATTACHMENT_EMAIL);
      attachments.push({
        fileType: file.fileType,
        filename: file.filename,
        url: file.url,
      });
    }
  }

  const attempt = recipient.attempts + 1;
  const claimed = await db.tradieRequestRecipient.updateMany({
    data: {
      attempts: attempt,
      deliveryStatus: TradieRequestDeliveryStatus.SENDING,
      lastAttemptAt: now,
      nextAttemptAt: null,
    },
    where: {
      attempts: recipient.attempts,
      deliveryStatus: recipient.deliveryStatus,
      id: recipient.id,
    },
  });
  if (claimed.count !== 1) {
    if (input.trigger === "manual") {
      throw new DomainTransitionError(
        "This email is already being sent. Refresh to see how it went.",
      );
    }
    return describe(recipient);
  }

  let failure: RequestSendFailure | null = null;
  try {
    await runOutboxEffectWithOutcome(
      db,
      {
        key: `tradie-request:${recipient.id}:${attempt}`,
        kind: OutboxEventKind.TRADIE_REQUEST_SEND,
        payload: { attempt, recipientId: recipient.id },
      },
      async () => {
        await ports.send({
          attachments,
          cc: recipient.ccAddresses,
          html: recipient.html,
          subject: recipient.subject,
          to: recipient.toAddress,
        });
        return { sent: true };
      },
    );
  } catch (error) {
    // The outbox refusing this attempt means it was already tried under this
    // key: whether it went is not known, so a person decides.
    failure =
      error instanceof DomainTransitionError
        ? "ambiguous"
        : ports.classifyFailure(error);
  }

  const outcome =
    failure === null
      ? {
          deliveryStatus: TradieRequestDeliveryStatus.SENT,
          lastError: null,
          nextAttemptAt: null,
          sentAt: now,
        }
      : deliveryAfterFailure(failure, attempt, input.trigger, now);
  await db.tradieRequestRecipient.updateMany({
    data: outcome,
    where: {
      attempts: attempt,
      deliveryStatus: TradieRequestDeliveryStatus.SENDING,
      id: recipient.id,
    },
  });
  await noteDelivery(
    principal,
    recipient,
    { attempt, reason: failure === null ? null : outcome.lastError },
    db,
  );
  return describe({ ...outcome, attempts: attempt });
}

/**
 * One attempt at a request email, on the tradie's history: sent, or why not.
 * After the send, so it never turns a sent email into an error.
 */
async function noteDelivery(
  principal: DomainPrincipal,
  recipient: {
    readonly tradieId: string;
    readonly toAddress: string;
    readonly request: { readonly projectId: string };
  },
  result: { readonly attempt: number; readonly reason: string | null },
  db: DomainDb,
): Promise<void> {
  const common = {
    projectId: recipient.request.projectId,
    to: recipient.toAddress,
    tradieId: recipient.tradieId,
    via: viaOf(principal),
  };
  await noteTradieActivity(
    result.reason === null
      ? {
          data: { ...common, attempt: Math.max(1, result.attempt) },
          principal,
          type: "requestEmailSent",
        }
      : {
          data: { ...common, reason: result.reason },
          principal,
          type: "requestEmailNotSent",
        },
    db,
  );
}

/**
 * Draft the scope lines a request lists under each activity.
 *
 * Writes nothing: the lines come back to the office to edit, and only what
 * they send is ever seen by a tradie. The facts the model is given are read
 * here, from milestones on a project the caller may manage, rather than
 * accepted from the screen.
 */
export async function draftTradieRequestWorkDetails(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly trade: string;
    readonly milestoneIds: readonly string[];
  },
  db: DomainDb,
  ai: TradieRequestAiPort,
): Promise<WorkDetailsDraft> {
  assertCanBookTradies(principal);
  if (input.milestoneIds.length === 0) {
    throw new DomainValidationError("Choose at least one activity.");
  }
  if (input.milestoneIds.length > MAX_REQUEST_ACTIVITIES) {
    throw new DomainValidationError(
      `A request can cover at most ${MAX_REQUEST_ACTIVITIES} activities.`,
    );
  }
  const project = await authorizeProject(principal, input.projectId, db);
  const details = await db.project.findUnique({
    select: { buildingType: true, description: true },
    where: { id: project.id },
  });
  if (!details) throw new DomainNotFoundError("Project not found");

  const milestones = await db.milestone.findMany({
    select: { description: true, id: true, name: true, projectStage: true },
    where: { id: { in: [...input.milestoneIds] }, projectId: project.id },
  });
  if (milestones.length !== new Set(input.milestoneIds).size) {
    throw new DomainNotFoundError(
      "One of the activities is not on this project.",
    );
  }

  return ai.draftWorkDetails({
    activities: milestones.map((milestone) => ({
      description: milestone.description,
      milestoneId: milestone.id,
      name: milestone.name,
      stage: milestone.projectStage,
    })),
    buildingType: details.buildingType,
    projectDescription: details.description,
    trade: input.trade,
  });
}
