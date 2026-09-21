"use server";

import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import {
  TradieSchedule,
  TradieScheduleStatus,
  Tradie,
  Project,
  User,
  Milestone,
} from "@prisma/client";
import type {
  CreateTradieScheduleInput,
  UpdateTradieScheduleInput,
} from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { createNotification } from "@/types/notification";
import { currency, dateFormat } from "@/utils/formatters";
import { after } from "next/server";
import { TradieScheduleListItem } from "@/types/project";
import { auth } from "@clerk/nextjs/server";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { getAllAdminUsersIds, getUserByClerkIdCached } from "./user";
import { authorizeProject } from "@/lib/domain/access/projects";
import {
  createTradieSchedule as createTradieScheduleDomain,
  createTradieSchedules as createTradieSchedulesDomain,
  requestTradieScheduleDeletion as requestTradieScheduleDeletionDomain,
  transitionTradieSchedule as transitionTradieScheduleDomain,
} from "@/lib/domain/tradies/schedules";
import { sendTradieScheduleReminder as sendTradieScheduleReminderDomain } from "@/lib/domain/tradies/reminders";
import { DomainNotFoundError, isDomainError } from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { sendEmail } from "../azureClient";
import {
  DeleteScheduleInput,
} from "@/types/tradie";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import { scheduleTotalCost } from "@/utils/calculations";
import { get } from "@vercel/blob";

interface TradieScheduleWithRelations extends TradieSchedule {
  tradie: Tradie;
  project: Project & { siteManager: User | null };
  milestone: Milestone | null;
}

/**
 * Converts a Prisma tradie schedule with its related entities into a
 * UI-friendly {@link TradieScheduleListItem}.
 *
 * @param schedule - The schedule including tradie, project, site manager,
 * and milestone relations.
 * @returns A formatted tradie schedule list item ready for display.
 */
const convertToTradieScheduleListItem = (
  schedule: TradieScheduleWithRelations,
): TradieScheduleListItem => {
  const coverted = {
    id: schedule.id,
    abn: schedule.tradie.abn,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
    lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
    tradeType: schedule.tradie.trade,
    projectId: schedule.projectId,
    projectName: schedule.project.name,
    taskLabel: schedule.milestone ? schedule.milestone.name : "General Task",
    scheduledDate: dateFormat.format(schedule.scheduledDate),
    durationDays: schedule.durationDays,
    status: schedule.status,
    isFavourite: schedule.tradie.isFavourite,
    note: schedule.tradie.note,
    updatedAt: dateFormat.format(schedule.updatedAt),
    requiresQuote: schedule.requiresQuote,
    quotedPrice: schedule.quotedPrice ?? undefined,
    contact: {
      email: schedule.tradie.email,
      phone: schedule.tradie.phone,
      additionalEmails: schedule.tradie.additionalEmails,
    },
    siteManager: {
      name: schedule.project.siteManager?.name || "",
      email: schedule.project.siteManager?.email || "",
      phone: schedule.project.siteManager?.phone || "",
    },
  } satisfies TradieScheduleListItem;

  return coverted;
};

/**
 * Ensures the currently authenticated user is the site manager of the
 * specified project before allowing schedule operations.
 *
 * @param projectId - The project whose schedule access should be validated.
 * @throws {Error} If the user is not authenticated.
 * @throws {Error} If the user cannot be found.
 * @throws {Error} If the project does not exist.
 * @throws {Error} If the authenticated user is not the project's site manager.
 */
// ADMIN, or the project's own site manager. The rule is
// lib/domain/access/projects.ts#canManageProject, which Eve's schedule tools
// call too — this used to be one of three separate spellings of it. The
// messages are unchanged, and the unused siteManager join went with the old
// query.
const userHasAccessToSchedule = async (projectId: string) => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new Error("User not found");
  }
  try {
    await authorizeProject(userPrincipal(user), projectId, prisma);
  } catch (error) {
    if (error instanceof DomainNotFoundError) {
      throw new Error("Project not found");
    }
    if (isDomainError(error)) {
      throw new Error("User does not have access to this schedule");
    }
    throw error;
  }

  // The whole user, not just the id: callers that go on to invoke a domain
  // command need a real principal, and inventing a role for one would make the
  // command's own authorization meaningless.
  return user;
};

/**
 * Creates a new tradie schedule for a project.
 *
 * The schedule is created with a default status of `PENDING`. After creation,
 * relevant cache tags are revalidated and a notification is sent to the
 * project's site manager.
 *
 * @param input - The schedule creation payload.
 * @returns The newly created schedule formatted as a {@link TradieScheduleListItem}.
 * @throws {Error} If the user does not have permission to create schedules
 * for the project or if the schedule cannot be created.
 */
export async function createTradieSchedule(input: CreateTradieScheduleInput) {
  try {
    const actingUser = await userHasAccessToSchedule(input.projectId);
    // The create itself is lib/domain/tradies/schedules.ts, shared with Eve's
    // booking tool. Two checks arrive with it that this path never had: the
    // milestone must belong to the project, and the tradie must not already
    // hold an overlapping active booking. A double-booked tradie cannot show
    // up to one of the two sites, and nothing here used to notice.
    const created = await createTradieScheduleDomain(
      userPrincipal(actingUser),
      {
        durationDays: input.durationDays ?? 1,
        milestoneId: input.milestoneId ?? null,
        projectId: input.projectId,
        requiresQuote: input.requiresQuote ?? false,
        scheduledDate: new Date(input.scheduledDate),
        tradieId: input.tradieId,
      },
      prisma,
    );
    const schedule = await prisma.tradieSchedule.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    const result = convertToTradieScheduleListItem(schedule);

    after(async () => {
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${schedule.projectId}`, CACHE_PROFILES.MEDIUM);
      const siteManagerId = schedule.project.siteManagerId;
      const notificationPayload = createNotification("tradieScheduleCreated", {
        tradieName: schedule.tradie.name,
        projectName: schedule.project.name,
        milestoneName: schedule.milestone
          ? schedule.milestone.name
          : "General Task",
        projectId: schedule.projectId,
        tradieTrade: schedule.tradie.trade,
        scheduleDate: dateFormat.format(schedule.scheduledDate),
      });
      const activityLogEntry = createActivityLogEntry("tradieScheduleCreated", {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        tradieId: schedule.tradieId,
        tradieName: schedule.tradie.name,
        trade: schedule.tradie.trade,
        scheduleDate: dateFormat.format(schedule.scheduledDate),
        durationDays: schedule.durationDays,
        cost:
          schedule.quotedPrice ??
          currency.format(
            scheduleTotalCost(
              parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
              schedule.durationDays,
              schedule.tradie.lastQuotedPriceUnit,
            ),
          ),
        milestoneId: schedule.milestoneId ?? undefined,
        milestoneName: schedule.milestone
          ? schedule.milestone.name
          : "General Task",
      });
      await logAction(activityLogEntry);
      await triggerNotification(
        siteManagerId ? [siteManagerId] : [],
        notificationPayload,
      );
      const emailContent = generateTradieOutreachEmail(result);
      await sendEmail({
        to: schedule.tradie.email,
        subject: emailContent.subject,
        body: emailContent.html,
      });
    });

    return result;
  } catch (error) {
    console.error("Error creating tradie schedule:", error);
    throw new Error("Failed to create tradie schedule.");
  }
}

/**
 * Creates multiple tradie schedules in a single operation.
 *
 * All schedules are created with a default status of `PENDING`. After
 * successful creation, cache tags are revalidated and notifications are
 * sent for each created schedule.
 *
 * @param inputs - An array of schedule creation payloads.
 * @returns An array of formatted {@link TradieScheduleListItem} objects.
 * @throws {Error} If no inputs are provided.
 * @throws {Error} If the user does not have permission to create schedules
 * for the project or if the operation fails.
 */
export async function bulkCreateTradieSchedules(
  inputs: CreateTradieScheduleInput[],
) {
  try {
    if (inputs.length === 0) {
      throw new Error("No inputs provided for bulk creation.");
    }
    const projectId = inputs[0].projectId;
    const actingUser = await userHasAccessToSchedule(projectId);
    const created = await createTradieSchedulesDomain(
      userPrincipal(actingUser),
      inputs.map((input) => ({
        durationDays: input.durationDays ?? 1,
        milestoneId: input.milestoneId ?? null,
        projectId: input.projectId,
        requiresQuote: input.requiresQuote ?? false,
        scheduledDate: new Date(input.scheduledDate),
        tradieId: input.tradieId,
      })),
      prisma,
    );
    const stored = await prisma.tradieSchedule.findMany({
      where: { id: { in: created.map((schedule) => schedule.id) } },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    const storedById = new Map(stored.map((schedule) => [schedule.id, schedule]));
    const schedules = created.map((schedule) => {
      const storedSchedule = storedById.get(schedule.id);
      if (!storedSchedule) throw new Error("Schedule not found after creation.");
      return storedSchedule;
    });

    after(async () => {
      const projectIds = Array.from(
        new Set(schedules.map((schedule) => schedule.projectId)),
      );
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      for (const projectId of projectIds) {
        revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
      }
      for (const schedule of schedules) {
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification(
          "tradieScheduleCreated",
          {
            tradieName: schedule.tradie.name,
            projectName: schedule.project.name,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            projectId: schedule.projectId,
            tradieTrade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
          },
        );
        const activityLogEntry = createActivityLogEntry(
          "tradieScheduleCreated",
          {
            projectId: schedule.projectId,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost:
              schedule.quotedPrice ??
              currency.format(
                scheduleTotalCost(
                  parseFloat(
                    schedule.tradie.lastQuotedPrice?.toString() ?? "0",
                  ),
                  schedule.durationDays,
                  schedule.tradie.lastQuotedPriceUnit,
                ),
              ),
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
          },
        );
        await logAction(activityLogEntry);
        await triggerNotification(
          siteManagerId ? [siteManagerId] : [],
          notificationPayload,
        );
        const emailContent = inputs.find(
          (input) => input.tradieId === schedule.tradieId,
        )!.emailContent;
        if (!emailContent) continue;
        const attachments: { name: string; contentBytes: string }[] = [];
        for (const attachment of emailContent.attachments) {
          const blob = await get(attachment.url, { access: "public" });

          if (!blob?.stream) continue;

          const reader = blob.stream.getReader();
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;
            if (value) chunks.push(value);
          }

          const buffer = Buffer.concat(
            chunks.map((chunk) => Buffer.from(chunk)),
          );

          attachments.push({
            name: attachment.name,
            contentBytes: buffer.toString("base64"),
          });
        }
        await sendEmail({
          to: schedule.tradie.email,
          subject: emailContent.subject,
          body: emailContent.body,
          cc:
            schedule.tradie.additionalEmails.length > 0
              ? schedule.tradie.additionalEmails
              : undefined,
          attachments:
            attachments.length > 0
              ? attachments.map((att) => ({
                  name: att.name,
                  contentBytes: att.contentBytes,
                }))
              : undefined,
        });
      }
    });

    return schedules.map(convertToTradieScheduleListItem);
  } catch (error) {
    console.error("Error bulk creating tradie schedules:", error);
    throw new Error("Failed to bulk create tradie schedules.");
  }
}

/**
 * Updates the status of an existing tradie schedule.
 *
 * If the updated status is `DECLINED`, the returned result indicates that
 * the schedule requires a replacement tradie. After updating, cache tags
 * are revalidated and the project site manager is notified.
 *
 * @param scheduleId - The ID of the schedule to update.
 * @param updates - The schedule update payload.
 * @returns An object containing the updated schedule and a flag indicating
 * whether a replacement tradie is required.
 * @throws {Error} If the schedule does not exist.
 * @throws {Error} If the user does not have permission to update the schedule.
 * @throws {Error} If the update operation fails.
 */
export async function updateTradieSchedule(
  scheduleId: string,
  updates: UpdateTradieScheduleInput,
  options: { statusAlreadyApplied?: boolean; approvalId?: string } = {},
) {
  try {
    const existingSchedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      include: { project: true },
    });
    if (!existingSchedule) {
      throw new Error("Schedule not found");
    }
    const actingUser = await userHasAccessToSchedule(existingSchedule.projectId);
    const changed = await transitionTradieScheduleDomain(
      userPrincipal(actingUser),
      {
        quote: updates.quote,
        quoteUnit: updates.quoteUnit,
        scheduleId,
        statusAlreadyApplied: options.statusAlreadyApplied,
        toStatus: updates.status,
      },
      prisma,
    );
    const schedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    if (!schedule) throw new Error("Schedule not found after status update.");
    const declinesPendingApproval =
      changed.previousStatus === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL &&
      updates.status === TradieScheduleStatus.DECLINED;
    const requiresReplacement = updates.status === TradieScheduleStatus.DECLINED;
    after(async () => {
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${schedule.projectId}`, CACHE_PROFILES.MEDIUM);
      if (declinesPendingApproval) {
        revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
        revalidateTag("approval-kpi", CACHE_PROFILES.MEDIUM);
      }
      // Numeric, deliberately. calculateScheduleTotalCost returns a FORMATTED
      // string, so `parseFloat(totalCost.toString())` below was parsing "$4,800"
      // and yielding NaN — every approval and activity entry without an explicit
      // quote displayed "$NaN". Format at the point of display instead.
      const totalCost = scheduleTotalCost(
        parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
        schedule.durationDays,
        schedule.tradie.lastQuotedPriceUnit,
      );

      if (updates.status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL) {
        revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
        revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
        const notificationPayload = createNotification(
          "tradieScheduleApproval",
          {
            approvalId: changed.approvalId ?? "",
            scheduleId: schedule.id,
            projectId: schedule.projectId,
            projectName: schedule.project.name,
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            scheduledDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
          },
        );
        const activityLogEntry = createActivityLogEntry(
          "tradieScheduleAvailable",
          {
            projectId: schedule.projectId,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
          },
        );
        await logAction(activityLogEntry);
        await triggerNotification(
          await getAllAdminUsersIds(),
          notificationPayload,
        );
      } else if (updates.status === TradieScheduleStatus.QUOTE_RECEIVED) {
        const activityLogEntry = createActivityLogEntry(
          "tradieScheduleQuoted",
          {
            projectId: schedule.projectId,
            milestoneId: schedule.milestoneId ?? undefined,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            quote: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
          },
        );
        await logAction(activityLogEntry);
        await updateTradieSchedule(schedule.id, {
          status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
        });
      } else if (updates.status === TradieScheduleStatus.CONFIRMED) {
        const activityLogPayload = createActivityLogEntry(
          "tradieScheduleUpdated",
          {
            projectId: schedule.projectId,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            approved: true,
          },
        );
        const notificationPayload = createNotification(
          "tradieScheduleApproved",
          {
            approvalId: options.approvalId ?? "",
            scheduleId: schedule.id,
            projectId: schedule.projectId,
            projectName: schedule.project.name,
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            scheduledDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
          },
        );
        await logAction(activityLogPayload);
        await triggerNotification(
          schedule.project.siteManagerId
            ? [schedule.project.siteManagerId]
            : [],
          notificationPayload,
        );
      } else if (updates.status === TradieScheduleStatus.DECLINED) {
        const activityLogPayload = createActivityLogEntry(
          "tradieScheduleUpdated",
          {
            projectId: schedule.projectId,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            approved: false,
          },
        );
        const notificationPayload = createNotification(
          "tradieScheduleRejected",
          {
            approvalId: options.approvalId ?? "",
            scheduleId: schedule.id,
            projectId: schedule.projectId,
            projectName: schedule.project.name,
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            scheduledDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost: currency.format(
              schedule.quotedPrice
                ? parseFloat(schedule.quotedPrice)
                : totalCost,
            ),
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
          },
        );
        await triggerNotification(
          schedule.project.siteManagerId
            ? [schedule.project.siteManagerId]
            : [],
          notificationPayload,
        );
        await logAction(activityLogPayload);
      } else {
        const statusLabel = schedule.status
          .split("_")
          .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
          .join(" ");
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification(
          "tradieScheduleUpdated",
          {
            tradieName: schedule.tradie.name,
            projectName: schedule.project.name,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            projectId: schedule.projectId,
            tradieTrade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            status: statusLabel,
          },
        );
        await triggerNotification(
          siteManagerId ? [siteManagerId] : [],
          notificationPayload,
        );
      }
    });

    return {
      schedule: convertToTradieScheduleListItem(schedule),
      requiresReplacement,
    };
  } catch (error) {
    console.error("Error updating tradie schedule:", error);
    throw new Error("Failed to update tradie schedule.");
  }
}

/**
 * Raises an admin approval request to remove a booked tradie schedule.
 *
 * Removal is never immediate. A booking that has been sent to a tradie — and
 * in most cases confirmed by them — represents a commitment the site manager
 * cannot quietly withdraw, so the request is recorded as a
 * `SCHEDULE_DELETION` approval and every admin is notified. The schedule row
 * is only deleted once an admin approves, in {@link handleAdminApproval}.
 *
 * @param input - The schedule to remove and the reason an admin will judge.
 * @returns Whether the request was raised, with a message for the caller and
 * the id of the approval when one was created.
 */
export async function requestTradieScheduleDeletion(
  input: DeleteScheduleInput,
) {
  try {
    const schedule = await prisma.tradieSchedule.findUnique({
      where: { id: input.scheduleId },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    if (!schedule) {
      throw new Error("Schedule not found");
    }
    const actingUser = await userHasAccessToSchedule(schedule.projectId);
    const requested = await requestTradieScheduleDeletionDomain(
      userPrincipal(actingUser),
      input,
      prisma,
    );

    const totalCost = scheduleTotalCost(
      parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
      schedule.durationDays,
      schedule.tradie.lastQuotedPriceUnit,
    );
    const cost = currency.format(
      schedule.quotedPrice ? parseFloat(schedule.quotedPrice) : totalCost,
    );
    const scheduledDate = dateFormat.format(schedule.scheduledDate);
    const milestoneName = schedule.milestone
      ? schedule.milestone.name
      : "General Task";

    after(async () => {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
      const requester = await prisma.user.findUnique({
        where: { id: actingUser.id },
        select: { name: true },
      });
      const notificationPayload = createNotification(
        "tradieScheduleDeletionRequest",
        {
          approvalId: requested.approvalId,
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName,
          scheduledDate,
          durationDays: schedule.durationDays,
          cost,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          reason: input.reason,
          requestedBy: requester?.name ?? "A site manager",
        },
      );
      const activityLogEntry = createActivityLogEntry(
        "tradieScheduleDeletionRequested",
        {
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: scheduledDate,
          durationDays: schedule.durationDays,
          cost,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName,
          reason: input.reason,
        },
      );
      await logAction(activityLogEntry);
      // Guarded because triggerNotification reads an empty recipient list as
      // "broadcast to every user" — a request meant for admins must not reach
      // the whole company if none are configured.
      const adminIds = await getAllAdminUsersIds();
      if (adminIds.length > 0) {
        await triggerNotification(adminIds, notificationPayload);
      }
    });

    return {
      success: true,
      message: "Deletion request submitted for admin approval.",
      approvalId: requested.approvalId,
    };
  } catch (error) {
    console.error("Error requesting tradie schedule deletion:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to request schedule deletion.",
    };
  }
}

/**
 * Sends a reminder email to the tradie booked on a schedule.
 *
 * Staff only, and always to that schedule's tradie. This used to take the
 * recipient from the browser and check nobody, so any signed-in user could
 * send any subject and body to any address from Royal's mailbox.
 *
 * @param scheduleId - The schedule whose tradie is reminded.
 * @param subject - The subject of the reminder email.
 * @param body - The body content of the reminder email.
 * @returns `success: false` with a message for a refusal or a tradie with no email.
 * @throws {Error} If the email sending operation fails.
 */
export async function sendTradieScheduleReminder({
  scheduleId,
  subject,
  body,
}: {
  scheduleId: string;
  subject: string;
  body: string;
}) {
  const access = await requireInternalUser();
  if (!access.ok) {
    return { success: false, message: access.error };
  }

  try {
    const idempotencyKey = createHash("sha256")
      .update(`${scheduleId}\0${subject}\0${body}`)
      .digest("hex");
    await sendTradieScheduleReminderDomain(
      userPrincipal(access.user),
      { body, idempotencyKey, scheduleId, subject },
      prisma,
      (input) => sendEmail(input),
    );

    return { success: true, message: "Reminder sent successfully." };
  } catch (error) {
    if (isDomainError(error)) {
      return { success: false, message: error.message };
    }
    console.error("Error sending tradie schedule reminder:", error);
    throw new Error("Failed to send tradie schedule reminder.");
  }
}
