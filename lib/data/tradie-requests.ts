"use server";

import { TradieRequestKind, type User } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { start } from "workflow/api";

import { auth } from "@clerk/nextjs/server";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import { getProjectDetail } from "@/lib/domain/projects/queries";
import {
  deliverTradieRequest,
  sendTradieRequests,
  type TradieRequestDelivery,
} from "@/lib/domain/tradies/requests";
import {
  recordManualQuote,
  requestTradeCancellation,
  selectTradeQuote,
} from "@/lib/domain/tradies/trade-selection";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import { tradieRequestMail } from "@/lib/projects/tradie-request-mail";
import { retryTradieRequestEmail } from "@/lib/workflow/tradie-request-retry";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import { PROJECT_STAGE_LABELS, type ProjectDetail } from "@/types/project";
import {
  generateTradieBookingEmail,
  generateTradieRequestEmail,
} from "@/utils/generate-email";
import {
  manualTradieQuoteSchema,
  retryTradieRequestEmailSchema,
  selectTradeQuoteSchema,
  sendTradieRequestsSchema,
  tradeCancellationRequestSchema,
  type ManualTradieQuoteFormInput,
  type SendTradieRequestsFormInput,
} from "@/utils/validators/tradies";
import {
  loadScheduleRecords,
  recordApprovalRaised,
  recordScheduleCreated,
} from "./tradie-schedule-records";
import { getAllAdminUsersIds, getUserByClerkIdCached } from "./user";

// The Tradies tab's request, quote and selection actions.
//
// Each one checks the caller, hands the decision to lib/domain, and answers
// with the project as it now stands, so the screen shows what the server
// committed rather than what it guessed. A refusal comes back as a value: a
// thrown Server Action message is an opaque digest in production.

type WithProject<T> = { ok: true; project: ProjectDetail } & T;

/**
 * The signed-in user behind the request. Which project they may act on is the
 * domain's call (`authorizeProject` in every command here): an ADMIN, or the
 * project's own site manager.
 *
 * Not `currentPrincipal()`: with no session at all it answers as the system,
 * which may manage every project — and these actions email tradies.
 */
async function staff(): Promise<{ user: User; principal: DomainPrincipal }> {
  const { userId } = await auth();
  if (!userId) throw new DomainAuthorizationError("Sign in to continue.");
  const user = await getUserByClerkIdCached(userId);
  if (!user) throw new DomainAuthorizationError("Sign in to continue.");
  return { principal: userPrincipal(user), user };
}

function parse<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new DomainValidationError(
      result.error.issues[0]?.message ?? "Some details are missing.",
    );
  }
  return result.data;
}

async function freshProject(
  principal: DomainPrincipal,
  projectId: string,
): Promise<ProjectDetail> {
  const project = await getProjectDetail(principal, projectId, prisma);
  if (!project) throw new DomainNotFoundError("Project not found");
  return project;
}

function expireProject(projectId: string, approvals = false) {
  revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  if (approvals) {
    revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
    revalidateTag("approval-kpi", CACHE_PROFILES.MEDIUM);
  }
}

/**
 * Hand each email that is waiting on an automatic retry to the workflow.
 *
 * Inline, not in `after()`, so a failure to start is logged against this
 * request. If one does not start the email is not lost: it shows as retrying,
 * and once its retry is overdue the screen offers the Retry button.
 */
async function scheduleRetries(deliveries: readonly TradieRequestDelivery[]) {
  for (const delivery of deliveries) {
    if (delivery.status !== "RETRYING") continue;
    try {
      await start(retryTradieRequestEmail, [delivery.recipientId]);
    } catch (error) {
      console.error(
        `Could not schedule retries for request email ${delivery.recipientId}:`,
        error,
      );
    }
  }
}

function failure(error: unknown, what: string): DomainActionFailure {
  const refused = domainActionFailure(error);
  if (refused) return refused;
  console.error(`Error trying to ${what}:`, error);
  throw new Error(`Failed to ${what}.`);
}

// ---------------------------------------------------------------------------

export type SentTradieRequestsResult = WithProject<{
  kind: TradieRequestKind;
  trade: string;
  deliveries: TradieRequestDelivery[];
  /** A direct booking: how many other tradies' open bookings it cancelled. */
  cancelled: number;
}>;

/**
 * Sends a tradie request: one trade, several activities, one or more
 * companies, each of which receives one email covering every activity. A
 * direct booking is the same with one company and the booking email.
 *
 * The email is rendered from the copy the office reviewed, with the same
 * `generateTradieRequestEmail` / `generateTradieBookingEmail` the wizard
 * previews, stored, and sent before this returns, so the answer says who
 * received it. A send that clearly did not go out is retried by the workflow;
 * anything else waits for a person.
 */
export async function sendTradieRequestsForProject(
  raw: SendTradieRequestsFormInput,
): Promise<SentTradieRequestsResult | DomainActionFailure> {
  try {
    const { principal } = await staff();
    const input = parse(sendTradieRequestsSchema.safeParse(raw));
    const siteManager = await prisma.project.findUnique({
      select: {
        siteManager: { select: { email: true, name: true, phone: true } },
      },
      where: { id: input.projectId },
    });
    const workLines = new Map(
      input.activities.map((activity) => [
        activity.milestoneId,
        activity.workLines,
      ]),
    );

    const sent = await sendTradieRequests(
      principal,
      {
        activities: input.activities.map((activity) => ({
          durationDays: activity.durationDays,
          milestoneId: activity.milestoneId,
          scheduledDate: new Date(`${activity.scheduledDate}T00:00:00.000Z`),
        })),
        kind: input.kind,
        note: input.note,
        projectId: input.projectId,
        subject: input.subject,
        trade: input.trade,
        tradieIds: input.tradieIds,
      },
      prisma,
      {
        ...tradieRequestMail,
        render: ({
          activities,
          kind,
          project,
          reference,
          subject,
          trade,
          tradieName,
        }) =>
          (kind === TradieRequestKind.BOOKING
            ? generateTradieBookingEmail
            : generateTradieRequestEmail)({
            activities: activities.map((activity) => ({
              durationDays: activity.durationDays,
              name: activity.name,
              scheduledDate: activity.scheduledDate.toISOString(),
              stage: PROJECT_STAGE_LABELS[activity.projectStage],
              workLines: workLines.get(activity.milestoneId) ?? [],
            })),
            note: input.note,
            projectName: project.name,
            reference,
            siteManager: {
              email: siteManager?.siteManager?.email ?? "",
              name: siteManager?.siteManager?.name ?? "",
              phone: siteManager?.siteManager?.phone ?? "",
            },
            subject,
            trade,
            tradieName,
          }),
      },
    );
    await scheduleRetries(sent.deliveries);

    const scheduleIds = sent.schedules.map((schedule) => schedule.id);
    after(async () => {
      expireProject(input.projectId);
      for (const schedule of await loadScheduleRecords(scheduleIds)) {
        await recordScheduleCreated(schedule);
      }
    });

    return {
      cancelled: sent.cancelled.length,
      deliveries: [...sent.deliveries],
      kind: sent.kind,
      ok: true,
      project: await freshProject(principal, input.projectId),
      trade: sent.trade,
    };
  } catch (error) {
    return failure(error, "send the tradie request");
  }
}

export type RetriedTradieRequestResult = WithProject<{
  delivery: TradieRequestDelivery;
}>;

/** A person retrying one request email that failed or whose retry stalled. */
export async function retryTradieRequestEmailForProject(raw: {
  projectId: string;
  recipientId: string;
}): Promise<RetriedTradieRequestResult | DomainActionFailure> {
  try {
    const { principal } = await staff();
    const input = parse(retryTradieRequestEmailSchema.safeParse(raw));
    const delivery = await deliverTradieRequest(
      principal,
      {
        projectId: input.projectId,
        recipientId: input.recipientId,
        trigger: "manual",
      },
      prisma,
      tradieRequestMail,
    );
    after(() => expireProject(input.projectId));
    return {
      delivery,
      ok: true,
      project: await freshProject(principal, input.projectId),
    };
  } catch (error) {
    return failure(error, "retry the request email");
  }
}

export type RecordedManualQuoteResult = WithProject<{
  tradieName: string;
  activityCount: number;
}>;

/** Record a quote the office received outside email, per activity. */
export async function recordManualTradieQuote(
  raw: ManualTradieQuoteFormInput,
): Promise<RecordedManualQuoteResult | DomainActionFailure> {
  try {
    const { principal } = await staff();
    const input = parse(manualTradieQuoteSchema.safeParse(raw));
    const recorded = await recordManualQuote(
      principal,
      {
        gstTreatment: input.gstTreatment,
        lines: input.lines,
        notes: input.notes,
        projectId: input.projectId,
        quotedAt: new Date(`${input.quotedAt}T00:00:00.000Z`),
        trade: input.trade,
        tradieId: input.tradieId,
        validUntil: input.validUntil
          ? new Date(`${input.validUntil}T00:00:00.000Z`)
          : null,
      },
      prisma,
    );
    const createdIds = recorded.bookings
      .filter((booking) => booking.created)
      .map((booking) => booking.scheduleId);
    after(async () => {
      expireProject(input.projectId);
      for (const schedule of await loadScheduleRecords(createdIds)) {
        await recordScheduleCreated(schedule);
      }
    });
    return {
      activityCount: recorded.bookings.length,
      ok: true,
      project: await freshProject(principal, input.projectId),
      tradieName: recorded.tradieName,
    };
  } catch (error) {
    return failure(error, "record the quote");
  }
}

export type SelectedTradeQuoteResult = WithProject<{
  tradieName: string;
  trade: string;
  approvals: number;
  cancelled: number;
}>;

/**
 * Choose one tradie for a trade: their bookings go to admin approval with
 * their quoted amounts, and other tradies' bookings on the same activities
 * are cancelled.
 */
export async function selectTradeQuoteForProject(raw: {
  projectId: string;
  tradieId: string;
  trade?: string;
}): Promise<SelectedTradeQuoteResult | DomainActionFailure> {
  try {
    const { principal } = await staff();
    const input = parse(selectTradeQuoteSchema.safeParse(raw));
    const selected = await selectTradeQuote(principal, input, prisma);
    after(async () => {
      expireProject(input.projectId, selected.approvals.length > 0);
      const records = await loadScheduleRecords(
        selected.approvals.map((approval) => approval.scheduleId),
      );
      for (const approval of selected.approvals) {
        const record = records.find((row) => row.id === approval.scheduleId);
        if (record) await recordApprovalRaised(record, approval.approvalId);
      }
    });
    return {
      approvals: selected.approvals.length,
      cancelled: selected.cancelled.length,
      ok: true,
      project: await freshProject(principal, input.projectId),
      trade: selected.trade,
      tradieName: selected.tradieName,
    };
  } catch (error) {
    return failure(error, "select the quote");
  }
}

/** Ask the admins to release the tradie selected for a trade. */
export async function requestTradeCancellationForProject(raw: {
  projectId: string;
  selectionId: string;
  reason: string;
}): Promise<WithProject<{ approvalId: string }> | DomainActionFailure> {
  try {
    const { principal, user } = await staff();
    const input = parse(tradeCancellationRequestSchema.safeParse(raw));
    const requested = await requestTradeCancellation(
      principal,
      {
        projectId: input.projectId,
        reason: input.reason,
        selectionId: input.selectionId,
      },
      prisma,
    );
    after(async () => {
      expireProject(input.projectId, true);
      await triggerNotification(
        await getAllAdminUsersIds(),
        createNotification("tradeCancellationRequest", {
          approvalId: requested.approvalId,
          projectId: requested.projectId,
          projectName: requested.projectName,
          reason: input.reason,
          requestedBy: user.name,
          trade: requested.trade,
          tradieId: requested.tradieId,
          tradieName: requested.tradieName,
        }),
      );
    });
    return {
      approvalId: requested.approvalId,
      ok: true,
      project: await freshProject(principal, input.projectId),
    };
  } catch (error) {
    return failure(error, "request the cancellation");
  }
}
