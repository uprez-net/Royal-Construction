import {
  MilestoneStatus,
  OutboxEventKind,
  Prisma,
  TradieRequestDeliveryStatus,
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
import { authorizeProject } from "../access/projects";
import { runOutboxEffectWithOutcome } from "../outbox";
import type {
  TradieRequestAiPort,
  WorkDetailsDraft,
} from "../ports/tradie-request-ai";
import { requireActiveTradie } from "./lifecycle";
import {
  canRetryRequestEmail,
  deliveryAfterFailure,
  type RequestSendFailure,
} from "./request-delivery";
import {
  activityAcceptsTrade,
  isRequestableMilestone,
  MAX_REQUEST_ACTIVITIES,
  MAX_REQUEST_TRADIES,
  sameTrade,
  tradeList,
} from "./request-rules";
import { createTradieSchedules, type CreatedSchedule } from "./schedules";

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
  readonly projectId: string;
  readonly tradieIds: readonly string[];
  readonly activities: readonly TradieRequestActivityInput[];
  readonly subject: string;
  readonly note?: string | null;
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
  readonly trade: string;
  readonly schedules: readonly CreatedSchedule[];
  readonly deliveries: readonly TradieRequestDelivery[];
};

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
  if (!input.subject.trim()) {
    throw new DomainValidationError("Give the email a subject.", "subject");
  }
  assertDistinct(input.tradieIds, "tradie");
  assertDistinct(
    input.activities.map((activity) => activity.milestoneId),
    "activity",
  );
  for (const activity of input.activities) {
    if (!Number.isInteger(activity.durationDays) || activity.durationDays < 1) {
      throw new DomainValidationError(
        "Each activity needs a duration of at least one day.",
        "durationDays",
      );
    }
  }

  const project = await authorizeProject(principal, input.projectId, db);

  const tradies: Awaited<ReturnType<typeof requireActiveTradie>>[] = [];
  for (const tradieId of input.tradieIds) {
    tradies.push(await requireActiveTradie(tradieId, db));
  }
  const trade = tradies[0].trade.trim();
  const otherTrade = tradies.find((tradie) => !sameTrade(tradie.trade, trade));
  if (otherTrade) {
    throw new DomainValidationError(
      `${otherTrade.name} is listed under ${otherTrade.trade.trim() || "no trade"}, not ${trade}. Send each trade as its own request.`,
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
  // is sent, now and on every retry.
  const emails = tradies.map((tradie) => ({
    tradie,
    ...ports.render({
      activities,
      project: { id: project.id, name: project.name },
      subject: input.subject.trim(),
      trade,
      tradieName: tradie.name,
    }),
  }));

  const write = async (tx: DomainDb) => {
    const request = await tx.tradieRequest.create({
      data: {
        createdById: attributionUserId(principal),
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
          requiresQuote: true,
          scheduledDate: activity.scheduledDate,
          tradieId: tradie.id,
        })),
      ),
      tx,
    );
    return { recipients, requestId: request.id, schedules };
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
    deliveries,
    requestId: written.requestId,
    schedules: written.schedules,
    trade,
  };
}

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
      request: { select: { projectId: true } },
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
  return describe({ ...outcome, attempts: attempt });
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
