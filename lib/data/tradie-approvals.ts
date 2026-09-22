"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import pLimit from "p-limit";

import { resolveTradieApproval } from "@/lib/domain/tradies/approvals";
import { userPrincipal } from "@/lib/domain/principal";
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
  try {
    const approval = await prisma.tradieApproval.findUnique({
      include: { tradie: true, user: true },
      where: { id: approvalId },
    });
    if (!approval) throw new Error("Approval request not found");
    return {
      ...approval,
      requestBy: approval.user.name,
      tradie: {
        ...approval.tradie,
        lastQuotedPrice: approval.tradie.lastQuotedPrice?.toString(),
        rating: approval.tradie.rating?.toString(),
      },
      updationData: approval.updationData as unknown as TradieApprovalPayload,
    };
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
      revalidateTag("approval-kpi", CACHE_PROFILES.MEDIUM);
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
    });

    // The domain commits the state transition. Reuse the existing App
    // side-effect adapter for the site-manager notification/activity path;
    // Eve has its own audit boundary and does not have a Next request cache.
    if (
      resolved.actionType === "SCHEDULE_APPROVAL" &&
      typeof resolved.affected.scheduleId === "string"
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
            appliedStatus: approved
              ? "PENDING_FINAL_CONFIRMATION"
              : "DECLINED",
            approvalId: resolved.approvalId,
            statusAlreadyApplied: true,
          },
        );
      });
    }
    if (
      resolved.actionType === "SCHEDULE_DELETION" &&
      typeof resolved.affected.scheduleId === "string"
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
    throw new Error("Failed to handle admin approval");
  }
}

export async function handleBulkAdminApproval(inputs: ApprovalInput[]) {
  try {
    await authorisedForApproval();
    const limit = pLimit(5);
    return await Promise.all(
      inputs.map((input) => limit(() => handleAdminApproval(input))),
    );
  } catch (error) {
    console.error("Error handling bulk admin approvals:", error);
    throw new Error("Failed to handle bulk admin approvals");
  }
}

export async function fetchTradieApprovals(
  query: TradieApprovalQuery,
): Promise<PaginatedTradieApprovals> {
  try {
    const { search, type, status, page, pageSize } = query;
    const whereClause: Prisma.TradieApprovalWhereInput[] = [];
    if (search) {
      whereClause.push({
        tradie: {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { trade: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      });
    }
    if (type) whereClause.push({ actionType: type });
    if (status) whereClause.push({ status });

    const where = whereClause.length > 0 ? { AND: whereClause } : undefined;
    const [approvals, totalCount] = await Promise.all([
      prisma.tradieApproval.findMany({
        include: { tradie: true, user: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      prisma.tradieApproval.count({ where }),
    ]);

    const safeApprovals: SafeTradieApproval[] = approvals.map((approval) => ({
      ...approval,
      requestBy: approval.user.name,
      tradie: {
        ...approval.tradie,
        lastQuotedPrice: approval.tradie.lastQuotedPrice?.toString(),
        rating: approval.tradie.rating?.toString(),
      },
      updationData: approval.updationData as unknown as TradieApprovalPayload,
    }));
    return { approvals: safeApprovals, page, pageSize, totalCount };
  } catch (error) {
    console.error("Error fetching tradie approvals:", error);
    throw new Error("Error fetching tradie approvals");
  }
}

interface KpiResult {
  pendingCount: bigint;
  priceChangeCount: bigint;
  incidentReportCount: bigint;
  deletionCount: bigint;
  scheduleCount: bigint;
  scheduleDeletionCount: bigint;
  acceptedCount: bigint;
  rejectedCount: bigint;
}

export async function fetchApprovalKPI(): Promise<ApprovalKPI> {
  try {
    const [row] = await prisma.$queryRaw<KpiResult[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING') AS "pendingCount",
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "actionType" = 'PRICE_CHANGE') AS "priceChangeCount",
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "actionType" = 'INCIDENT_RESOLUTION') AS "incidentReportCount",
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "actionType" = 'TRADIE_REMOVAL') AS "deletionCount",
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "actionType" = 'SCHEDULE_APPROVAL') AS "scheduleCount",
        COUNT(*) FILTER (WHERE status = 'PENDING' AND "actionType" = 'SCHEDULE_DELETION') AS "scheduleDeletionCount",
        COUNT(*) FILTER (WHERE status = 'APPROVED') AS "acceptedCount",
        COUNT(*) FILTER (WHERE status = 'REJECTED') AS "rejectedCount"
      FROM "TradieApproval"
    `;
    if (!row) throw new Error("Approval KPI query returned no row");
    return {
      deletionCount: Number(row.deletionCount),
      incidentReportCount: Number(row.incidentReportCount),
      pendingCount: Number(row.pendingCount),
      priceChangeCount: Number(row.priceChangeCount),
      resolvedCount: {
        accepted: Number(row.acceptedCount),
        rejected: Number(row.rejectedCount),
      },
      scheduleCount: Number(row.scheduleCount),
      scheduleDeletionCount: Number(row.scheduleDeletionCount),
    };
  } catch (error) {
    console.error("Error fetching approval KPI:", error);
    throw new Error("Error fetching approval KPI");
  }
}

export async function fetchApprovalKPICached(): Promise<ApprovalKPI> {
  "use cache";
  cacheTag("approval-kpi");
  cacheLife(CACHE_PROFILES.MEDIUM);
  return fetchApprovalKPI();
}

export async function fetchTradieApprovalsCached(
  query: TradieApprovalQuery,
): Promise<PaginatedTradieApprovals> {
  "use cache";
  cacheTag("approval-query");
  cacheLife(CACHE_PROFILES.MEDIUM);
  return fetchTradieApprovals(query);
}
