'use server';
import prisma from "@/lib/prisma";
import { TradieSchedule, TradieScheduleStatus, Tradie, Project, User, Milestone, TradieApprovalActionType } from "@prisma/client";
import type { CreateTradieScheduleInput, UpdateTradieScheduleInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { createNotification } from "@/types/notification";
import { currency, dateFormat } from "@/utils/formatters";
import { after } from "next/server"
import { TradieScheduleListItem } from "@/types/project";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { sendEmail } from "../azureClient";
import { ScheduleApprovalJsonPayload, TRADIE_SCHEDULE_STATE_MACHINE } from "@/types/tradie";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import { calculateScheduleTotalCost as calculateTotalCost } from "@/utils/calculations";

interface TradieScheduleWithRelations extends TradieSchedule {
  tradie: Tradie;
  project: Project & { siteManager: User | null };
  milestone: Milestone | null;
}

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

/**
 * Converts a Prisma tradie schedule with its related entities into a
 * UI-friendly {@link TradieScheduleListItem}.
 *
 * @param schedule - The schedule including tradie, project, site manager,
 * and milestone relations.
 * @returns A formatted tradie schedule list item ready for display.
 */
const convertToTradieScheduleListItem = (schedule: TradieScheduleWithRelations): TradieScheduleListItem => {
  const coverted = {
    id: schedule.id,
    abn: schedule.tradie.abn,
    tradieId: schedule.tradieId,
    tradieName: schedule.tradie.name,
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
      phone: schedule.tradie.phone
    },
    siteManager: {
      name: schedule.project.siteManager?.name || "",
      email: schedule.project.siteManager?.email || "",
      phone: schedule.project.siteManager?.phone || ""
    }
  } satisfies TradieScheduleListItem;

  return coverted;
}

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
const userHasAccessToSchedule = async (projectId: string) => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new Error("User not found");
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { siteManager: true }
  });
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.siteManagerId !== user.id && user.id !== ADMIN_USER_ID) {
    throw new Error("User does not have access to this schedule");
  }

  return user.id;
}

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
    await userHasAccessToSchedule(input.projectId);
    const schedule = await prisma.tradieSchedule.create({
      data: {
        tradieId: input.tradieId,
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        scheduledDate: new Date(input.scheduledDate),
        durationDays: input.durationDays ?? 1,
        status: input.requiresQuote ? TradieScheduleStatus.AWAITING_QUOTE : TradieScheduleStatus.PENDING,
        requiresQuote: input.requiresQuote ?? false,
      },
      include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
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
        milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
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
        cost: schedule.quotedPrice ?? calculateTotalCost(parseFloat(schedule.tradie.hourlyRate?.toString() ?? "0"), schedule.durationDays),
        milestoneId: schedule.milestoneId ?? undefined,
        milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
      });
      await logAction(activityLogEntry);
      await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
      const emailContent = generateTradieOutreachEmail(result);
      await sendEmail({
        to: schedule.tradie.email,
        subject: emailContent.subject,
        body: emailContent.html,
      });
    });


    return result;
  }
  catch (error) {
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
export async function bulkCreateTradieSchedules(inputs: CreateTradieScheduleInput[]) {
  try {
    if (inputs.length === 0) {
      throw new Error("No inputs provided for bulk creation.");
    }
    const projectId = inputs[0].projectId;
    await userHasAccessToSchedule(projectId);
    const schedules = await prisma.tradieSchedule.createManyAndReturn({
      data: inputs.map(input => ({
        tradieId: input.tradieId,
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        scheduledDate: new Date(input.scheduledDate),
        durationDays: input.durationDays ?? 1,
        status: input.requiresQuote ? TradieScheduleStatus.AWAITING_QUOTE : TradieScheduleStatus.PENDING,
        requiresQuote: input.requiresQuote ?? false,
      })),
      include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
    });

    after(async () => {
      const projectIds = Array.from(new Set(schedules.map(schedule => schedule.projectId)));
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      for (const projectId of projectIds) {
        revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
      }
      for (const schedule of schedules) {
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification("tradieScheduleCreated", {
          tradieName: schedule.tradie.name,
          projectName: schedule.project.name,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
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
          cost: schedule.quotedPrice ?? calculateTotalCost(parseFloat(schedule.tradie.hourlyRate?.toString() ?? "0"), schedule.durationDays),
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
        });
        await logAction(activityLogEntry);
        await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
        const emailContent = generateTradieOutreachEmail(convertToTradieScheduleListItem(schedule));
        await sendEmail({
          to: schedule.tradie.email,
          subject: emailContent.subject,
          body: emailContent.html,
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
export async function updateTradieSchedule(scheduleId: string, updates: UpdateTradieScheduleInput) {
  try {
    const existingSchedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      include: { project: true },
    });
    if (!existingSchedule) {
      throw new Error("Schedule not found");
    }
    const userId = await userHasAccessToSchedule(existingSchedule.projectId);
    if (!TRADIE_SCHEDULE_STATE_MACHINE[existingSchedule.status].includes(updates.status)) {
      throw new Error(`Invalid status transition from ${existingSchedule.status} to ${updates.status}`);
    }
    const schedule = await prisma.tradieSchedule.update({
      where: { id: scheduleId },
      data: { status: updates.status },
      include: { tradie: true, project: { include: { siteManager: true } }, milestone: true },
    });

    const requiresReplacement = updates.status === TradieScheduleStatus.DECLINED;
    after(async () => {
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${schedule.projectId}`, CACHE_PROFILES.MEDIUM);
      const totalCost = calculateTotalCost(parseFloat(schedule.tradie.hourlyRate?.toString() ?? "0"), schedule.durationDays);

      if (updates.status === TradieScheduleStatus.AWAITING_ADMIN_APPROVAL) {
        const approval = await prisma.tradieApproval.create({
          data: {
            tradieId: schedule.tradieId,
            actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
            requestedBy: userId,
            reason: `${schedule.tradie.name} has confirmed their availability for the scheduled task on ${dateFormat.format(schedule.scheduledDate)}. Please review and approve.`,
            payload: {
              scheduleId: schedule.id,
              projectId: schedule.projectId,
              projectName: schedule.project.name,
              milestoneId: schedule.milestoneId ?? undefined,
              milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
              scheduledDate: dateFormat.format(schedule.scheduledDate),
              durationDays: schedule.durationDays,
              cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
            } satisfies ScheduleApprovalJsonPayload,
          },
          select: {
            id: true,
          }
        });
        revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
        revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
        const notificationPayload = createNotification('tradieScheduleApproval', {
          approvalId: approval.id,
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          scheduledDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
        });
        const activityLogEntry = createActivityLogEntry('tradieScheduleAvailable', {
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
        });
        await logAction(activityLogEntry);
        await triggerNotification([ADMIN_USER_ID], notificationPayload);
      }
      else if (updates.status === TradieScheduleStatus.QUOTE_RECEIVED) {
        const activityLogEntry = createActivityLogEntry("tradieScheduleQuoted", {
          projectId: schedule.projectId,
          milestoneId: schedule.milestoneId ?? undefined,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          quote: schedule.quotedPrice ?? totalCost,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
        });
        await logAction(activityLogEntry);
        await updateTradieSchedule(schedule.id, { status: TradieScheduleStatus.AWAITING_ADMIN_APPROVAL });
      }
      else if (updates.status === TradieScheduleStatus.CONFIRMED) {
        const activityLogPayload = createActivityLogEntry('tradieScheduleUpdated', {
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          approved: true,
        });
        const notificationPayload = createNotification('tradieScheduleApproved', {
          approvalId: "approval.id",
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          scheduledDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
        });
        await logAction(activityLogPayload);
        await triggerNotification(schedule.project.siteManagerId ? [schedule.project.siteManagerId] : [], notificationPayload);
      }
      else if (updates.status === TradieScheduleStatus.DECLINED) {
        const activityLogPayload = createActivityLogEntry('tradieScheduleUpdated', {
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          approved: false,
        });
        const notificationPayload = createNotification('tradieScheduleRejected', {
          approvalId: "approval.id",
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          scheduledDate: dateFormat.format(schedule.scheduledDate),
          durationDays: schedule.durationDays,
          cost: currency.format(parseFloat(schedule.quotedPrice ?? totalCost.toString())),
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
        });
        await triggerNotification(schedule.project.siteManagerId ? [schedule.project.siteManagerId] : [], notificationPayload);
        await logAction(activityLogPayload);
      }
      else {
        const statusLabel = schedule.status.split("_").map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification("tradieScheduleUpdated", {
          tradieName: schedule.tradie.name,
          projectName: schedule.project.name,
          milestoneName: schedule.milestone ? schedule.milestone.name : "General Task",
          projectId: schedule.projectId,
          tradieTrade: schedule.tradie.trade,
          scheduleDate: dateFormat.format(schedule.scheduledDate),
          status: statusLabel,
        });
        await triggerNotification(siteManagerId ? [siteManagerId] : [], notificationPayload);
      }
    });

    return { schedule: convertToTradieScheduleListItem(schedule), requiresReplacement };
  } catch (error) {
    console.error("Error updating tradie schedule:", error);
    throw new Error("Failed to update tradie schedule.");
  }

}