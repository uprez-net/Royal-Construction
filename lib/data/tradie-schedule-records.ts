import "server-only";

import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { triggerNotification } from "@/lib/notification/novu";
import { createActivityLogEntry } from "@/types/activityLog";
import { createNotification } from "@/types/notification";
import { scheduleTotalCost } from "@/utils/calculations";
import { currency, dateFormat } from "@/utils/formatters";
import { logAction } from "./actionLog";
import { getAllAdminUsersIds } from "./user";

// The post-commit records a booking change leaves behind: the activity-log
// row and the in-app notification. Shared by the schedule and request
// actions, which used to each carry a copy. Not "use server": every export of
// such a module is a POST endpoint, and these are not for the browser.

const scheduleInclude = {
  milestone: true,
  project: { include: { siteManager: true } },
  tradie: true,
} as const;

export type CreatedScheduleRecord = Prisma.TradieScheduleGetPayload<{
  include: typeof scheduleInclude;
}>;

function bookingCost(schedule: CreatedScheduleRecord): string {
  return schedule.quotedPrice
    ? currency.format(parseFloat(schedule.quotedPrice))
    : currency.format(
        scheduleTotalCost(
          parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
          schedule.durationDays,
          schedule.tradie.lastQuotedPriceUnit,
        ),
      );
}

export function loadScheduleRecords(
  scheduleIds: readonly string[],
): Promise<CreatedScheduleRecord[]> {
  return prisma.tradieSchedule.findMany({
    include: scheduleInclude,
    where: { id: { in: [...scheduleIds] } },
  });
}

/** The activity-log row and site-manager notification for a new booking. */
export async function recordScheduleCreated(schedule: CreatedScheduleRecord) {
  const siteManagerId = schedule.project.siteManagerId;
  const notificationPayload = createNotification("tradieScheduleCreated", {
    tradieName: schedule.tradie.name,
    projectName: schedule.project.name,
    milestoneName: schedule.milestone
      ? schedule.milestone.name
      : "General Task",
    projectId: schedule.projectId,
    tradieTrade: schedule.trade?.trim() || schedule.tradie.trade,
    scheduleDate: dateFormat.format(schedule.scheduledDate),
  });
  const activityLogEntry = createActivityLogEntry("tradieScheduleCreated", {
    projectId: schedule.projectId,
    scheduleId: schedule.id,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
    trade: schedule.trade?.trim() || schedule.tradie.trade,
    scheduleDate: dateFormat.format(schedule.scheduledDate),
    durationDays: schedule.durationDays,
    cost:
      schedule.quotedPrice
      ?? currency.format(
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
}

/**
 * The admins' notification and the activity row for a booking that has just
 * gone to the approval queue — the same pair the status dialog raises, so an
 * approval from a selected quote reads like any other.
 */
export async function recordApprovalRaised(
  schedule: CreatedScheduleRecord,
  approvalId: string,
) {
  const milestoneName = schedule.milestone
    ? schedule.milestone.name
    : "General Task";
  await logAction(
    createActivityLogEntry("tradieScheduleAvailable", {
      cost: bookingCost(schedule),
      durationDays: schedule.durationDays,
      milestoneId: schedule.milestoneId ?? undefined,
      milestoneName,
      projectId: schedule.projectId,
      scheduleDate: dateFormat.format(schedule.scheduledDate),
      scheduleId: schedule.id,
      trade: schedule.trade?.trim() || schedule.tradie.trade,
      tradieId: schedule.tradieId,
      tradieName: schedule.tradie.name,
    }),
  );
  await triggerNotification(
    await getAllAdminUsersIds(),
    createNotification("tradieScheduleApproval", {
      approvalId,
      cost: bookingCost(schedule),
      durationDays: schedule.durationDays,
      milestoneId: schedule.milestoneId ?? undefined,
      milestoneName,
      projectId: schedule.projectId,
      projectName: schedule.project.name,
      scheduleId: schedule.id,
      scheduledDate: dateFormat.format(schedule.scheduledDate),
      trade: schedule.trade?.trim() || schedule.tradie.trade,
      tradieId: schedule.tradieId,
      tradieName: schedule.tradie.name,
    }),
  );
}
