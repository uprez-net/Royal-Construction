import "server-only";

import prisma from "@/lib/prisma";
import {
  Milestone,
  Project,
  Tradie,
  TradieSchedule,
  TradieScheduleStatus,
  User,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { isDomainError } from "@/lib/domain/errors";
import { transitionTradieSchedule as transitionTradieScheduleDomain } from "@/lib/domain/tradies/schedules";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import type { TradieScheduleListItem } from "@/types/project";
import { scheduleTotalCost } from "@/utils/calculations";
import { currency, dateFormat } from "@/utils/formatters";
import type { UpdateTradieScheduleInput } from "@/utils/validators";
import { triggerNotification } from "../notification/novu";
import { logAction } from "./actionLog";
import { getAllAdminUsersIds } from "./user";

// A tradie schedule status change and everything it sets off: the cache
// invalidation, the activity entry, the approval or site-manager notification.
//
// Server-only rather than "use server" because it takes the acting principal
// as an argument. Exported from a "use server" module it would be an endpoint
// any browser could post `{ kind: "system" }` at. `updateTradieSchedule` in
// ./tradieSchedules.ts is that endpoint, and resolves the signed-in user
// first; the Graph webhook calls this directly as the system.

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
export const convertToTradieScheduleListItem = (
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
    refToken: schedule.refToken,
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
 * Updates the status of an existing tradie schedule, as `principal`.
 *
 * The caller has already decided who is acting: the Server Action resolves
 * the signed-in user, and the Graph webhook — which has no Clerk session —
 * acts as the system. The domain transition authorizes `principal` itself.
 *
 * If the updated status is `DECLINED`, the returned result indicates that
 * the schedule requires a replacement tradie. After updating, cache tags
 * are revalidated and the project site manager is notified.
 *
 * @param scheduleId - The ID of the schedule to update.
 * @param updates - The schedule update payload.
 * @returns An object containing the updated schedule and a flag indicating
 * whether a replacement tradie is required.
 * @throws {DomainError} Unchanged, when the transition refuses — not allowed
 * from the current status, or `principal` may not manage the project — so
 * the caller can show the operator which.
 * @throws {Error} If the schedule does not exist or the update fails.
 */
export async function applyTradieScheduleUpdate(
  principal: DomainPrincipal,
  scheduleId: string,
  updates: UpdateTradieScheduleInput,
  options: {
    statusAlreadyApplied?: boolean;
    /** The status actually committed, when the caller wants another's effects. */
    appliedStatus?: TradieScheduleStatus;
    approvalId?: string;
  } = {},
) {
  try {
    const existingSchedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      include: { project: true },
    });
    if (!existingSchedule) {
      throw new Error("Schedule not found");
    }
    const changed = await transitionTradieScheduleDomain(
      principal,
      {
        appliedStatus: options.appliedStatus,
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
      changed.previousStatus === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL
      && updates.status === TradieScheduleStatus.DECLINED;
    const requiresReplacement =
      updates.status === TradieScheduleStatus.DECLINED;
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
        await applyTradieScheduleUpdate(principal, schedule.id, {
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
    if (isDomainError(error)) throw error;
    console.error("Error updating tradie schedule:", error);
    throw new Error("Failed to update tradie schedule.");
  }
}
