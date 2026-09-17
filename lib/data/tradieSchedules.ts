"use server";
import prisma from "@/lib/prisma";
import {
  TradieSchedule,
  TradieScheduleStatus,
  Tradie,
  Project,
  User,
  Milestone,
  TradieApprovalActionType,
  TradieApprovalStatus,
} from "@prisma/client";
import type {
  CreateTradieScheduleInput,
  UpdateTradieScheduleInput,
} from "@/utils/validators";
import { TradiePriceUnit } from "@prisma/client";
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
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { sendEmail } from "../azureClient";
import {
  DeleteScheduleInput,
  ScheduleApprovalJsonPayload,
  ScheduleDeletionJsonPayload,
  TRADIE_SCHEDULE_STATE_MACHINE,
} from "@/types/tradie";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import {
  normalizeQuoteBasis,
  parseQuotedAmount,
  scheduleTotalCost,
} from "@/utils/calculations";
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
    include: { siteManager: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.siteManagerId !== user.id && user.role !== "ADMIN") {
    throw new Error("User does not have access to this schedule");
  }

  return user.id;
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
    await userHasAccessToSchedule(input.projectId);
    const schedule = await prisma.tradieSchedule.create({
      data: {
        tradieId: input.tradieId,
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        scheduledDate: new Date(input.scheduledDate),
        durationDays: input.durationDays ?? 1,
        status: input.requiresQuote
          ? TradieScheduleStatus.AWAITING_QUOTE
          : TradieScheduleStatus.PENDING,
        requiresQuote: input.requiresQuote ?? false,
      },
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
    await userHasAccessToSchedule(projectId);
    const schedules = await prisma.tradieSchedule.createManyAndReturn({
      data: inputs.map((input) => ({
        tradieId: input.tradieId,
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        scheduledDate: new Date(input.scheduledDate),
        durationDays: input.durationDays ?? 1,
        status: input.requiresQuote
          ? TradieScheduleStatus.AWAITING_QUOTE
          : TradieScheduleStatus.PENDING,
        requiresQuote: input.requiresQuote ?? false,
      })),
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
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
) {
  try {
    const existingSchedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      include: { project: true },
    });
    if (!existingSchedule) {
      throw new Error("Schedule not found");
    }
    const userId = await userHasAccessToSchedule(existingSchedule.projectId);
    if (
      !TRADIE_SCHEDULE_STATE_MACHINE[existingSchedule.status].includes(
        updates.status,
      )
    ) {
      throw new Error(
        `Invalid status transition from ${existingSchedule.status} to ${updates.status}`,
      );
    }
    // The quote was accepted as input and then dropped — `data` only ever
    // carried the status. So a tradie could email "$5,000 for the job", the
    // extractor would pull it out, the status would flip to QUOTE_RECEIVED,
    // and every downstream number still fell back to `quotedPrice ?? totalCost`
    // with quotedPrice null. Admins approved against an hourly estimate rather
    // than the price the tradie actually quoted.
    const quotedAmount = parseQuotedAmount(updates.quote);
    // The amount alone does not say what it buys. A tradie replying "$950 a
    // day" and one replying "$950 for the job" send the same number, and
    // storing either as the job price makes one of them wrong by the length of
    // the job. Normalise the basis first, then cost it.
    const quoted =
      quotedAmount !== null
        ? normalizeQuoteBasis(quotedAmount, updates.quoteUnit ?? "FIXED")
        : null;

    const schedule = await prisma.tradieSchedule.update({
      where: { id: scheduleId },
      data: {
        status: updates.status,
        // `quotedPrice` is the whole job, which is what every downstream
        // display and approval treats it as - so a rate has to be costed
        // across the booked duration before it lands here.
        ...(quoted !== null
          ? {
              quotedPrice: scheduleTotalCost(
                quoted.amount,
                existingSchedule.durationDays,
                quoted.unit,
              ).toFixed(2),
              requiresQuote: true,
            }
          : {}),
      },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });

    // Recording the quote against the tradie is what makes `lastQuotedPrice`
    // mean what it says. It carries the RATE the tradie named, not the job
    // total - the total belongs to this one schedule and its duration, while
    // the rate is what they will charge on the next one. FIXED used to be
    // hardcoded here, which restated every hourly and daily quote as a lump
    // sum the moment it arrived by email.
    if (quoted !== null) {
      await prisma.tradie
        .update({
          where: { id: schedule.tradieId },
          data: {
            lastQuotedPrice: quoted.amount.toFixed(2),
            lastQuotedPriceUnit:
              quoted.unit === "HOURLY"
                ? TradiePriceUnit.HOURLY
                : TradiePriceUnit.FIXED,
          },
        })
        .catch((error) =>
          // Best effort: the schedule already carries the quote, and losing the
          // tradie-level copy must not fail the status change that recorded it.
          console.error(
            `[tradie ${schedule.tradieId}] failed to record last quoted price`,
            error,
          ),
        );
    }

    const requiresReplacement =
      updates.status === TradieScheduleStatus.DECLINED;
    after(async () => {
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${schedule.projectId}`, CACHE_PROFILES.MEDIUM);
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
        const approval = await prisma.tradieApproval.create({
          data: {
            tradieId: schedule.tradieId,
            actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
            requestedBy: userId,
            reason: `${schedule.tradie.name} has confirmed their availability for the scheduled task on ${dateFormat.format(schedule.scheduledDate)}. Please review and approve.`,
            updationData: {
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
            } satisfies ScheduleApprovalJsonPayload,
          },
          select: {
            id: true,
          },
        });
        revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
        revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
        const notificationPayload = createNotification(
          "tradieScheduleApproval",
          {
            approvalId: approval.id,
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
            approvalId: "approval.id",
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
            approvalId: "approval.id",
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
    const userId = await userHasAccessToSchedule(schedule.projectId);

    // Without this an impatient click sends the same booking to the admin
    // queue twice, and the second approval then fails on a row the first one
    // already deleted.
    const pendingRequest = await prisma.tradieApproval.findFirst({
      where: {
        tradieId: schedule.tradieId,
        actionType: TradieApprovalActionType.SCHEDULE_DELETION,
        status: TradieApprovalStatus.PENDING,
        updationData: { path: ["scheduleId"], equals: schedule.id },
      },
      select: { id: true },
    });
    if (pendingRequest) {
      return {
        success: false,
        message:
          "A deletion request for this schedule is already awaiting admin approval.",
      };
    }

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

    const approval = await prisma.tradieApproval.create({
      data: {
        tradieId: schedule.tradieId,
        actionType: TradieApprovalActionType.SCHEDULE_DELETION,
        requestedBy: userId,
        reason: input.reason,
        // The booking is described here rather than looked up later on
        // purpose: once the approval is granted the schedule row is gone, and
        // the resolved request still has to read as a record of what was
        // removed.
        updationData: {
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName,
          scheduledDate,
          durationDays: schedule.durationDays,
          cost,
          currentStatus: schedule.status,
        } satisfies ScheduleDeletionJsonPayload,
      },
      select: { id: true },
    });

    after(async () => {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const notificationPayload = createNotification(
        "tradieScheduleDeletionRequest",
        {
          approvalId: approval.id,
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
      approvalId: approval.id,
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
    const schedule = await prisma.tradieSchedule.findUnique({
      where: { id: scheduleId },
      select: { tradie: { select: { email: true } } },
    });
    if (!schedule) {
      return { success: false, message: "Schedule not found." };
    }
    const to = schedule.tradie.email.trim();
    if (!to) {
      return { success: false, message: "This tradie has no email address." };
    }

    await sendEmail({
      to,
      subject,
      body,
    });

    return { success: true, message: "Reminder sent successfully." };
  } catch (error) {
    console.error("Error sending tradie schedule reminder:", error);
    throw new Error("Failed to send tradie schedule reminder.");
  }
}
