import { MilestoneStatus, type ProjectStage } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { authorizeProject } from "../access/projects";
import type {
  TradieRequestAiPort,
  WorkDetailsDraft,
} from "../ports/tradie-request-ai";
import { requireActiveTradie } from "./lifecycle";
import {
  activityAcceptsTrade,
  isRequestableMilestone,
  MAX_REQUEST_ACTIVITIES,
  MAX_REQUEST_TRADIES,
  sameTrade,
} from "./request-rules";
import { createTradieSchedules, type CreatedSchedule } from "./schedules";

// A tradie request: one trade, several of the project's activities, sent to
// one or more companies so their quotes can be compared.
//
// Each company gets ONE email covering every activity. The bulk booking this
// replaces looked up a row's email by tradie, so a tradie booked onto three
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
// The bookings are written in one transaction first, then each email is sent.
// A failed send does not undo the bookings: it is reported per company, so
// the screen can say exactly who did not get it rather than claiming success.
// A retry cannot double-send either, because the second attempt is refused as
// the same booking twice before anything goes out.

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
};

export type TradieRequestRecipient = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly additionalEmails: readonly string[];
};

export type TradieRequestActivity = {
  readonly milestoneId: string;
  readonly name: string;
  readonly projectStage: ProjectStage;
  readonly scheduledDate: Date;
  readonly durationDays: number;
};

/** Sends one company its request. Throws when the mail was not accepted. */
export type TradieRequestEmailPort = (message: {
  readonly project: { readonly id: string; readonly name: string };
  readonly trade: string;
  readonly tradie: TradieRequestRecipient;
  readonly activities: readonly TradieRequestActivity[];
}) => Promise<void>;

export type TradieRequestDelivery = {
  readonly tradieId: string;
  readonly tradieName: string;
  readonly to: string;
} & (
  | { readonly status: "sent" }
  | { readonly status: "failed"; readonly reason: string }
);

export type SentTradieRequests = {
  readonly trade: string;
  readonly schedules: readonly CreatedSchedule[];
  readonly deliveries: readonly TradieRequestDelivery[];
};

function assertDistinct(ids: readonly string[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new DomainValidationError(`The same ${what} is listed twice.`);
  }
}

export async function sendTradieRequests(
  principal: DomainPrincipal,
  input: SendTradieRequestsInput,
  db: DomainDb,
  send: TradieRequestEmailPort,
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

  const tradies = [];
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
      requiredTradeType: { select: { label: true } },
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
      const required = milestone.requiredTradeType?.label;
      if (required && !activityAcceptsTrade(required, trade)) {
        throw new DomainValidationError(
          `${milestone.name} needs ${required}, not ${trade}.`,
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

  // Every booking or none: the same command and checks as a single booking,
  // in one serialisable transaction.
  const schedules = await createTradieSchedules(
    principal,
    tradies.flatMap((tradie) =>
      activities.map((activity) => ({
        durationDays: activity.durationDays,
        milestoneId: activity.milestoneId,
        projectId: project.id,
        requiresQuote: true,
        scheduledDate: activity.scheduledDate,
        tradieId: tradie.id,
      })),
    ),
    db,
  );

  const deliveries: TradieRequestDelivery[] = [];
  for (const tradie of tradies) {
    const recipient: TradieRequestRecipient = {
      additionalEmails: tradie.additionalEmails,
      email: tradie.email.trim(),
      id: tradie.id,
      name: tradie.name,
    };
    const delivery = {
      tradieId: tradie.id,
      tradieName: tradie.name,
      to: recipient.email,
    };
    try {
      await send({
        activities,
        project: { id: project.id, name: project.name },
        trade,
        tradie: recipient,
      });
      deliveries.push({ ...delivery, status: "sent" });
    } catch {
      // The provider's own message is not for the operator; the adapter logs
      // it. What they need is who missed out and what to do about it.
      deliveries.push({
        ...delivery,
        reason:
          "The email service did not accept the message. The request is saved; send a reminder from its row to try again.",
        status: "failed",
      });
    }
  }

  return { deliveries, schedules, trade };
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
