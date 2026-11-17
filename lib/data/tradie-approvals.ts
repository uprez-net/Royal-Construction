"use server";

import {
  TradieApprovalActionType,
  TradieApprovalStatus,
  type Prisma,
} from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import pLimit from "p-limit";

import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
import { bookingInTradeWhere } from "@/lib/domain/tradies/trade-selection";
import { INACTIVE_SCHEDULE_STATUSES } from "@/lib/domain/tradies/lifecycle";
import { sydneyDateOnly, sydneyToday } from "@/lib/dates/sydney";
import {
  compareNeedsDecision,
  dueFields,
  isDueThisWeek,
  oldestWaiting,
  openBookingKey,
  tradeCancellationProjectId,
  type DueFields,
  type DueSubject,
} from "@/lib/tradie-approvals/queue-order";
import { userPrincipal } from "@/lib/domain/principal";
import { domainActionFailure } from "@/lib/http/domain-response";
import prisma from "../prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { getUserByClerkIdCached } from "./user";
import { updateTradieSchedule } from "./tradieSchedules";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import type {
  ApprovalInput,
  SafeTradieApproval,
  TradieApprovalPayload,
} from "@/types/tradie";
import type {
  ApprovalKPI,
  PaginatedTradieApprovals,
  TradieApprovalQuery,
} from "@/types/tradie-approvals";

async function authorisedForApproval() {
  const { userId } = await auth();
  if (!userId) throw new Error("User not authenticated");
  const user = await getUserByClerkIdCached(userId);
  if (!user || user.role !== "ADMIN") {
    throw new Error("User not authorised for this action");
  }
  return user;
}

/** Read one approval; this adapter only shapes the row for the UI. */
export async function fetchTradieApprovalById(
  approvalId: string,
): Promise<SafeTradieApproval> {
  await authorisedForApproval();
  try {
    const approval = await prisma.tradieApproval.findUnique({
      include: { tradie: true, user: true },
      where: { id: approvalId },
    });
    if (!approval) throw new Error("Approval request not found");
    const [withDue] = await withDueFields([approval]);
    return toSafeApproval(withDue);
  } catch (error) {
    console.error("Error fetching tradie approval:", error);
    throw new Error("Error fetching tradie approval");
  }
}

/**
 * Authenticate and translate the transport payload, then call the one domain
 * approval state machine. Cache invalidation is intentionally post-commit App
 * work; Eve has no request cache to invalidate.
 */
export async function handleAdminApproval(input: ApprovalInput) {
  try {
    const user = await authorisedForApproval();
    const incidentResolution =
      input.payload && "resolution" in input.payload
        ? input.payload.resolution
        : undefined;
    const resolved = await resolveTradieApproval(
      userPrincipal(user),
      {
        reviewedBookingIds: input.reviewedBookingIds,
        actionType: input.type,
        approvalId: input.approvalId,
        incidentResolution,
        rejectionReason: input.rejectReason,
        resolution: input.resolution,
      },
      prisma,
    );

    after(() => {
      revalidateTag(`tradie-${resolved.tradieId}`, CACHE_PROFILES.MEDIUM);
      revalidateTag("tradie-management", CACHE_PROFILES.MEDIUM);
      if (resolved.actionType === "TRADIE_REMOVAL") {
        revalidateTag("tradies", CACHE_PROFILES.MEDIUM);
        revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
        revalidateTag("projects", CACHE_PROFILES.MEDIUM);
        const projectIds = resolved.affected.projectIds;
        if (Array.isArray(projectIds)) {
          for (const projectId of projectIds) {
            if (typeof projectId === "string")
              revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
          }
        }
      }
    });

    // The domain commits the state transition. Reuse the existing App
    // side-effect adapter for the site-manager notification/activity path;
    // Eve has its own audit boundary and does not have a Next request cache.
    if (
      resolved.actionType === "SCHEDULE_APPROVAL"
      && typeof resolved.affected.scheduleId === "string"
    ) {
      after(async () => {
        const approved = resolved.resolution === "approved";
        await updateTradieSchedule(
          resolved.affected.scheduleId as string,
          { status: approved ? "CONFIRMED" : "DECLINED" },
          {
            // Approving writes PENDING_FINAL_CONFIRMATION, not CONFIRMED, so
            // name the committed status separately from the side effects being
            // asked for — otherwise the guard throws here and the site manager
            // is never told the booking was approved.
            appliedStatus: approved ? "PENDING_FINAL_CONFIRMATION" : "DECLINED",
            approvalId: resolved.approvalId,
            statusAlreadyApplied: true,
          },
        );
      });
    }
    if (
      resolved.actionType === "SCHEDULE_DELETION"
      && typeof resolved.affected.scheduleId === "string"
    ) {
      after(async () => {
        revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
        revalidateTag("projects", CACHE_PROFILES.MEDIUM);
        if (typeof resolved.affected.projectId === "string") {
          revalidateTag(
            `project-${resolved.affected.projectId}`,
            CACHE_PROFILES.MEDIUM,
          );
        }

        if (resolved.affected.deleted === true) {
          await logAction(
            createActivityLogEntry("tradieScheduleDeleted", {
              projectId: resolved.affected.projectId as string,
              scheduleId: resolved.affected.scheduleId as string,
              tradieId: resolved.tradieId,
              tradieName: resolved.tradieName,
              trade: resolved.tradieTrade,
              scheduleDate: String(resolved.affected.scheduledDate ?? ""),
              milestoneId:
                typeof resolved.affected.milestoneId === "string"
                  ? resolved.affected.milestoneId
                  : undefined,
              milestoneName: String(
                resolved.affected.milestoneName ?? "General Task",
              ),
            }),
          );
        }

        const siteManagerId = resolved.affected.siteManagerId;
        if (typeof siteManagerId === "string") {
          await triggerNotification(
            [siteManagerId],
            createNotification("tradieScheduleDeletionResolved", {
              approvalId: resolved.approvalId,
              scheduleId: resolved.affected.scheduleId as string,
              projectId: resolved.affected.projectId as string,
              projectName: String(resolved.affected.projectName ?? ""),
              scheduledDate: String(resolved.affected.scheduledDate ?? ""),
              milestoneId:
                typeof resolved.affected.milestoneId === "string"
                  ? resolved.affected.milestoneId
                  : undefined,
              milestoneName: String(
                resolved.affected.milestoneName ?? "General Task",
              ),
              tradieId: resolved.tradieId,
              tradieName: resolved.tradieName,
              trade: resolved.tradieTrade,
              approved: resolved.resolution === "approved",
            }),
          );
        }
      });
    }

    if (
      resolved.actionType === "TRADE_CANCELLATION"
      && typeof resolved.affected.projectId === "string"
    ) {
      const projectId = resolved.affected.projectId;
      after(async () => {
        revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
        revalidateTag("projects", CACHE_PROFILES.MEDIUM);
        revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
        // The person who asked hears the answer; the admins already know it.
        const request = await prisma.tradieApproval.findUnique({
          select: { requestedBy: true },
          where: { id: resolved.approvalId },
        });
        if (request?.requestedBy) {
          await triggerNotification(
            [request.requestedBy],
            createNotification("tradeCancellationResolved", {
              approvalId: resolved.approvalId,
              approved: resolved.resolution === "approved",
              projectId,
              projectName: String(resolved.affected.projectName ?? ""),
              trade: String(resolved.affected.trade ?? resolved.tradieTrade),
              tradieName: resolved.tradieName,
            }),
          );
        }
      });
    }

    return {
      approvalId: resolved.approvalId,
      actionType: resolved.actionType,
      tradieId: resolved.tradieId,
      resolution: resolved.resolution,
      rejectReason: input.rejectReason ?? null,
      ...resolved.affected,
    };
  } catch (error) {
    console.error("Error handling admin approval:", error);
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw new Error("Failed to handle admin approval");
  }
}

/**
 * Resolve several approvals. Each one commits on its own, so a refusal on one
 * (say a booking that now overlaps) must not hide the others that went
 * through: the result names what resolved and what did not, and why.
 * Throwing for the whole batch used to report a failure for requests that had
 * in fact been approved, and the screen never learned they had.
 */
export async function handleBulkAdminApproval(inputs: ApprovalInput[]) {
  await authorisedForApproval();
  const limit = pLimit(5);
  const outcomes = await Promise.all(
    inputs.map((input) =>
      limit(async () => {
        try {
          const result = await handleAdminApproval(input);
          if ("ok" in result && result.ok === false) {
            return { approvalId: input.approvalId, error: result.error };
          }
          return { resolved: result as Exclude<typeof result, { ok: false }> };
        } catch (error) {
          console.error("Bulk admin approval item failed", error);
          return {
            approvalId: input.approvalId,
            error:
              error instanceof Error
                ? error.message
                : "Failed to handle admin approval",
          };
        }
      }),
    ),
  );
  return {
    resolved: outcomes.flatMap((outcome) =>
      "resolved" in outcome && outcome.resolved ? [outcome.resolved] : [],
    ),
    failed: outcomes.flatMap((outcome) =>
      "error" in outcome
        ? [{ approvalId: outcome.approvalId, error: outcome.error }]
        : [],
    ),
  };
}

type ApprovalWithRelations = Prisma.TradieApprovalGetPayload<{
  include: { tradie: true; user: true };
}>;

// Needs decision reads every pending request, as the counts do, so the list
// and the Waiting and Due this week figures always agree. The queue is a few
// dozen; ordering moves into SQL if it ever grows into the thousands.

/**
 * Adds the due date, its kind and overdue to each row. A trade cancellation's
 * due date is the earliest open booking its tradie holds on that project, in
 * that trade, so all of them are looked up in one query.
 */
async function withDueFields<T extends DueSubject & { tradieId: string }>(
  rows: readonly T[],
): Promise<Array<T & DueFields>> {
  const today = sydneyToday();
  // The booking a trade cancellation would cancel is found with the domain's
  // own rule (the tradie's open bookings on the project, in that trade), so the
  // due date names the booking that approval actually cancels. One query for
  // every pending trade cancellation; the earliest booking per key is kept.
  const keys = new Map<
    string,
    { tradieId: string; projectId: string; trade: string }
  >();
  for (const row of rows) {
    if (row.actionType !== "TRADE_CANCELLATION") continue;
    const projectId = tradeCancellationProjectId(row.updationData);
    const trade = (row.updationData as { trade?: unknown } | null)?.trade;
    if (!projectId || typeof trade !== "string" || !trade.trim()) continue;
    keys.set(openBookingKey(row.tradieId, projectId, trade), {
      tradieId: row.tradieId,
      projectId,
      trade,
    });
  }
  const earliest = new Map<string, string>();
  if (keys.size > 0) {
    const bookings = await prisma.tradieSchedule.findMany({
      where: {
        status: { notIn: INACTIVE_SCHEDULE_STATUSES },
        OR: [...keys.values()].map((key) => ({
          tradieId: key.tradieId,
          projectId: key.projectId,
          ...bookingInTradeWhere(key.trade),
        })),
      },
      orderBy: { scheduledDate: "asc" },
      select: {
        tradieId: true,
        projectId: true,
        trade: true,
        scheduledDate: true,
        tradie: { select: { trade: true } },
      },
    });
    for (const booking of bookings) {
      // bookingInTradeWhere's rule in memory: the booking's own trade, else
      // its tradie's. openBookingKey trims and lowercases, as the query's
      // case-insensitive match does.
      const trade = booking.trade ?? booking.tradie.trade ?? "";
      const key = openBookingKey(booking.tradieId, booking.projectId, trade);
      if (keys.has(key) && !earliest.has(key)) {
        earliest.set(key, sydneyDateOnly(booking.scheduledDate));
      }
    }
  }

  return rows.map((row) => {
    const projectId =
      row.actionType === "TRADE_CANCELLATION"
        ? tradeCancellationProjectId(row.updationData)
        : null;
    const trade = (row.updationData as { trade?: unknown } | null)?.trade;
    const openBooking =
      projectId && typeof trade === "string"
        ? (earliest.get(openBookingKey(row.tradieId, projectId, trade)) ?? null)
        : null;
    return { ...row, ...dueFields(row, today, openBooking) };
  });
}

function toSafeApproval(
  approval: ApprovalWithRelations & DueFields,
): SafeTradieApproval {
  return {
    ...approval,
    requestBy: approval.user?.name ?? approval.requestSource ?? "System",
    tradie: {
      ...approval.tradie,
      lastQuotedPrice: approval.tradie.lastQuotedPrice?.toString(),
      rating: approval.tradie.rating?.toString(),
    },
    updationData: approval.updationData as unknown as TradieApprovalPayload,
  };
}

export async function fetchTradieApprovals(
  query: TradieApprovalQuery,
): Promise<PaginatedTradieApprovals> {
  await authorisedForApproval();
  try {
    const { view, search, type, due, page, pageSize } = query;
    const filters: Prisma.TradieApprovalWhereInput[] = [];
    if (search) {
      filters.push({
        tradie: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { trade: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      });
    }
    if (type) filters.push({ actionType: type });
    const include = { tradie: true, user: true } as const;

    if (view === "decided") {
      // Due dates mean nothing once decided, so the due filter does not apply.
      const where: Prisma.TradieApprovalWhereInput = {
        AND: [
          ...filters,
          {
            status: {
              in: [
                TradieApprovalStatus.APPROVED,
                TradieApprovalStatus.REJECTED,
              ],
            },
          },
        ],
      };
      const totalCount = await prisma.tradieApproval.count({ where });
      const lastPage = Math.max(1, Math.ceil(totalCount / pageSize));
      const currentPage = Math.min(Math.max(1, page), lastPage);
      const approvals = await prisma.tradieApproval.findMany({
        include,
        orderBy: { updatedAt: "desc" },
        skip: (currentPage - 1) * pageSize,
        take: pageSize,
        where,
      });
      // A request about one booking keeps that booking's date (the row and
      // its description name it); only "overdue" stops meaning anything. A
      // trade cancellation's bookings are gone once approved, so it shows
      // when it was submitted.
      const today = sydneyToday();
      return {
        approvals: approvals.map((approval) =>
          toSafeApproval({
            ...approval,
            ...dueFields(approval, today, null),
            overdue: false,
          }),
        ),
        page: currentPage,
        pageSize,
        totalCount,
      };
    }

    // Needs decision: every pending request is loaded and ordered here, because
    // the due date comes from the booking, which the database cannot sort on.
    const pending = await prisma.tradieApproval.findMany({
      include,
      orderBy: { createdAt: "asc" },
      where: { AND: [...filters, { status: TradieApprovalStatus.PENDING }] },
    });
    const today = sydneyToday();
    const ordered = (await withDueFields(pending))
      .filter((row) => due !== "week" || isDueThisWeek(row, today))
      .sort(compareNeedsDecision);

    const totalCount = ordered.length;
    const lastPage = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = Math.min(Math.max(1, page), lastPage);
    const start = (currentPage - 1) * pageSize;
    return {
      approvals: ordered.slice(start, start + pageSize).map(toSafeApproval),
      page: currentPage,
      pageSize,
      totalCount,
    };
  } catch (error) {
    console.error("Error fetching tradie approvals:", error);
    throw new Error("Error fetching tradie approvals");
  }
}

export async function fetchApprovalKPI(): Promise<ApprovalKPI> {
  await authorisedForApproval();
  try {
    // The needs-decision list and these figures read the same pending rows
    // through withDueFields and the queue-order module, so they cannot disagree.
    const [pending, decidedGroups] = await Promise.all([
      prisma.tradieApproval.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          actionType: true,
          createdAt: true,
          id: true,
          tradieId: true,
          updationData: true,
        },
        where: { status: TradieApprovalStatus.PENDING },
      }),
      prisma.tradieApproval.groupBy({
        by: ["actionType"],
        where: {
          status: {
            in: [TradieApprovalStatus.APPROVED, TradieApprovalStatus.REJECTED],
          },
        },
        _count: { _all: true },
      }),
    ]);

    const waitingByType = zeroByType();
    const decidedByType = zeroByType();
    for (const row of pending) waitingByType[row.actionType] += 1;
    for (const group of decidedGroups) {
      decidedByType[group.actionType] += group._count._all;
    }

    const today = sydneyToday();
    const dueThisWeek = (await withDueFields(pending)).filter((row) =>
      isDueThisWeek(row, today),
    ).length;

    return {
      decided: Object.values(decidedByType).reduce((sum, n) => sum + n, 0),
      decidedByType,
      dueThisWeek,
      oldestWaiting: oldestWaiting(pending, today),
      waiting: pending.length,
      waitingByType,
    };
  } catch (error) {
    console.error("Error fetching approval KPI:", error);
    throw new Error("Error fetching approval KPI");
  }
}

function zeroByType(): Record<TradieApprovalActionType, number> {
  return Object.fromEntries(
    Object.values(TradieApprovalActionType).map((type) => [type, 0]),
  ) as Record<TradieApprovalActionType, number>;
}
