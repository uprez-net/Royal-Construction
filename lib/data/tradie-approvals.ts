'use server';
import prisma from "../prisma";
import type { PriceUpdateJsonPayload } from "@/types/tradie";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { after } from "next/server"
import { ApprovalInput, IncidentReportApprovalPayload, SafeTradieApproval, ScheduleApprovalJsonPayload, ScheduleDeletionJsonPayload, TradieApprovalPayload } from "@/types/tradie";
import { TradieApprovalActionType, TradieScheduleStatus } from "@prisma/client";
import { ApprovalKPI, PaginatedTradieApprovals, TradieApprovalQuery } from "@/types/tradie-approvals";
import { Prisma } from "@prisma/client";
import pLimit from "p-limit";
import { updateTradieSchedule } from "./tradieSchedules";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";

/**
 * Ensures the currently authenticated user is authorized to perform
 * administrative approval actions.
 *
 * Validates that:
 * - A user is authenticated via Clerk.
 * - The authenticated user exists in the application database.
 * - The user has the "ADMIN" role.
 *
 * @throws {Error} If the user is not authenticated.
 * @throws {Error} If the user is not authorized to perform the action.
 *
 * @returns {Promise<void>} Resolves when the user is successfully authorized.
 */
const authorisedForApproval = async () => {
    const { userId } = await auth();
    if (!userId) {
        throw new Error("User not authenticated");
    }
    const user = await getUserByClerkIdCached(userId);
    if (!user || user.role !== "ADMIN") {
        throw new Error("User not authorised for this action");
    }
}

/**
 * Retrieves a tradie approval record by its ID, including the associated tradie.
 *
 * @param {string} approvalId - The unique identifier of the approval record.
 *
 * @returns {Promise<SafeTradieApproval>}
 * The approval record with its related tradie data, or `null` if no record exists.
 *
 * @throws {Error} If an error occurs while fetching the approval record.
 */
export async function fetchTradieApprovalById(approvalId: string): Promise<SafeTradieApproval> {
    try {
        const approval = await prisma.tradieApproval.findUnique({
            where: { id: approvalId },
            include: {
                tradie: true,
                user: true,
            },
        });

        if (!approval) {
            throw new Error("Approval request not found");
        }

        return {
            ...approval,
            updationData: approval.updationData as unknown as TradieApprovalPayload,
            tradie: {
                ...approval.tradie,
                lastQuotedPrice: approval.tradie.lastQuotedPrice?.toString(),
                rating: approval.tradie.rating?.toString(),
            },
            requestBy: approval.user.name,
        };
    } catch (error) {
        console.error("Error fetching tradie approval:", error);
        throw new Error("Error fetching tradie approval");
    }
}

/**
 * Processes an admin approval request and executes the corresponding action.
 *
 * Supported approval actions:
 * - PRICE_CHANGE: Updates a tradie's hourly rate when approved.
 * - TRADIE_REMOVAL: Permanently removes a tradie when approved.
 * - INCIDENT_RESOLUTION: Updates an incident's resolution details and status.
 * - SCHEDULE_APPROVAL: Confirms or declines a tradie's booking.
 * - SCHEDULE_DELETION: Removes a booked schedule when approved.
 *
 * Requires an authenticated user and a valid approval request.
 *
 * @param input - Approval request containing the action type, resolution, and action-specific payload.
 * @returns Details of the processed action, including the final resolution and any affected entities.
 *
 * @throws Error If:
 * - The user is not authorised for this action.
 * - The user cannot be found.
 * - The approval request does not exist.
 * - The approval action type is unsupported.
 * - Any database operation fails.
 */
export async function handleAdminApproval(input: ApprovalInput) {
    try {
        await authorisedForApproval();
        const approval = await prisma.tradieApproval.findUnique({
            where: { id: input.approvalId },
            include: {
                tradie: true,
                user: true,
            },
        });
        if (!approval) {
            throw new Error("Approval request not found");
        }

        after(() => {
            revalidateTag(`tradie-${approval.tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
            revalidateTag('approval-kpi', CACHE_PROFILES.MEDIUM);
            revalidateTag('approval-query', CACHE_PROFILES.MEDIUM);
        });

        return await prisma.$transaction(async (tx) => {
            await tx.tradieApproval.update({
                where: { id: input.approvalId },
                data: {
                    status: input.resolution === "approved" ? "APPROVED" : "REJECTED",
                    rejectionReason: input.rejectReason ?? null,
                },
            });

            switch (input.type) {
                case TradieApprovalActionType.PRICE_CHANGE: {
                    // The price that gets applied is the one that was REQUESTED
                    // and stored on the approval, not one supplied by whoever
                    // resolves it. Reading input.payload let an approver write
                    // any amount — and, once the basis was added, any basis —
                    // regardless of what the requester asked for. Approving is a
                    // yes/no on a pending request, not a chance to rewrite it.
                    const requested = approval.updationData as unknown as
                        | PriceUpdateJsonPayload
                        | null;
                    const isApproved = input.resolution === "approved";

                    if (isApproved) {
                        if (typeof requested?.newHourlyRate !== "number") {
                            throw new Error(
                                "This price change request has no recorded amount and cannot be approved.",
                            );
                        }
                        await tx.tradie.update({
                            where: { id: approval.tradieId },
                            data: {
                                lastQuotedPrice: requested.newHourlyRate,
                                // Requests raised before the basis was captured
                                // leave the tradie's current one alone rather
                                // than guessing at hourly.
                                ...(requested.newPriceUnit
                                    ? { lastQuotedPriceUnit: requested.newPriceUnit }
                                    : {}),
                            },
                        });
                    }

                    return {
                        approvalId: approval.id,
                        actionType: TradieApprovalActionType.PRICE_CHANGE,
                        tradieId: approval.tradieId,
                        newHourlyRate: isApproved ? requested?.newHourlyRate : undefined,
                        resolution: input.resolution,
                    };
                }

                case TradieApprovalActionType.TRADIE_REMOVAL: {
                    const isApproved = input.resolution === "approved";

                    if (isApproved) {
                        await tx.tradie.delete({
                            where: { id: approval.tradieId },
                        });
                    }

                    return {
                        approvalId: approval.id,
                        actionType: TradieApprovalActionType.TRADIE_REMOVAL,
                        tradieId: approval.tradieId,
                        resolution: input.resolution,
                    };
                }

                case TradieApprovalActionType.INCIDENT_RESOLUTION: {
                    const payload = input.payload as IncidentReportApprovalPayload;
                    const incidentData = approval.updationData as {
                        incidentId: string;
                    };

                    const isApproved = input.resolution === "approved";

                    const updatedIncident = await tx.tradieIncident.update({
                        where: { id: incidentData.incidentId },
                        data: {
                            resolution: isApproved ? payload.resolution : null,
                            status: isApproved ? "RESOLVED" : "OPEN",
                        },
                    });

                    return {
                        approvalId: approval.id,
                        actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
                        tradieId: approval.tradieId,
                        incidentId: updatedIncident.id,
                        updatedIncident,
                        resolution: input.resolution,
                    };
                }

                case TradieApprovalActionType.SCHEDULE_APPROVAL: {
                    const isApproved = input.resolution === "approved";
                    const scheduleData = approval.updationData as unknown as ScheduleApprovalJsonPayload;

                    const updatedSchedule = await tx.tradieSchedule.update({
                        where: { id: scheduleData.scheduleId },
                        data: {
                            status: isApproved ? "CONFIRMED" : "DECLINED",
                        },
                    });

                    after(async () => {
                        if (isApproved) {
                            await updateTradieSchedule(updatedSchedule.id, { status: TradieScheduleStatus.CONFIRMED });
                        } else {
                            await updateTradieSchedule(updatedSchedule.id, { status: TradieScheduleStatus.DECLINED });
                        }
                    })

                    return {
                        approvalId: approval.id,
                        actionType: TradieApprovalActionType.SCHEDULE_APPROVAL,
                        tradieId: approval.tradieId,
                        scheduleId: updatedSchedule.id,
                        updatedSchedule,
                        resolution: input.resolution,
                        rejectReason: input.rejectReason ?? null,
                    };
                }

                case TradieApprovalActionType.SCHEDULE_DELETION: {
                    const isApproved = input.resolution === "approved";
                    const scheduleData = approval.updationData as unknown as
                        | ScheduleDeletionJsonPayload
                        | null;

                    // Approving means deleting a specific row, so a request
                    // that never recorded which one cannot be granted.
                    // Rejecting it is still allowed — that just clears the
                    // queue and changes nothing.
                    if (isApproved && !scheduleData?.scheduleId) {
                        throw new Error(
                            "This removal request has no recorded schedule and cannot be approved.",
                        );
                    }

                    // deleteMany rather than delete: the booking may already be
                    // gone by the time an admin gets to the queue, and a
                    // P2025 there would roll back the resolution and leave the
                    // request pending for ever.
                    const deletedCount = isApproved
                        ? (await tx.tradieSchedule.deleteMany({
                            where: { id: scheduleData!.scheduleId },
                        })).count
                        : 0;

                    // The schedule's own relations are gone by now, so the
                    // site manager is read from the project recorded on the
                    // request.
                    const project = scheduleData?.projectId
                        ? await tx.project.findUnique({
                            where: { id: scheduleData.projectId },
                            select: { siteManagerId: true },
                        })
                        : null;

                    after(async () => {
                        revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
                        revalidateTag("projects", CACHE_PROFILES.MEDIUM);
                        if (scheduleData?.projectId) {
                            revalidateTag(`project-${scheduleData.projectId}`, CACHE_PROFILES.MEDIUM);
                        }

                        if (isApproved && deletedCount > 0) {
                            await logAction(createActivityLogEntry("tradieScheduleDeleted", {
                                projectId: scheduleData!.projectId,
                                scheduleId: scheduleData!.scheduleId,
                                tradieId: approval.tradieId,
                                tradieName: approval.tradie.name,
                                trade: approval.tradie.trade,
                                scheduleDate: scheduleData!.scheduledDate,
                                milestoneId: scheduleData!.milestoneId,
                                milestoneName: scheduleData!.milestoneName,
                            }));
                        }

                        // Guarded rather than passing an empty array:
                        // triggerNotification treats [] as "broadcast to every
                        // user", so a project with no site manager would tell
                        // the whole company about one deleted booking.
                        if (project?.siteManagerId) {
                            const notificationPayload = createNotification("tradieScheduleDeletionResolved", {
                                approvalId: approval.id,
                                scheduleId: scheduleData!.scheduleId,
                                projectId: scheduleData!.projectId,
                                projectName: scheduleData!.projectName,
                                milestoneId: scheduleData!.milestoneId,
                                milestoneName: scheduleData!.milestoneName,
                                scheduledDate: scheduleData!.scheduledDate,
                                tradieId: approval.tradieId,
                                tradieName: approval.tradie.name,
                                trade: approval.tradie.trade,
                                approved: isApproved,
                            });
                            await triggerNotification(
                                [project.siteManagerId],
                                notificationPayload,
                            );
                        }
                    });

                    return {
                        approvalId: approval.id,
                        actionType: TradieApprovalActionType.SCHEDULE_DELETION,
                        tradieId: approval.tradieId,
                        scheduleId: scheduleData?.scheduleId,
                        deleted: isApproved && deletedCount > 0,
                        resolution: input.resolution,
                        rejectReason: input.rejectReason ?? null,
                    };
                }

                default:
                    throw new Error("Unknown approval action type");
            }
        });

    } catch (error) {
        console.error("Error handling admin approval:", error);
        throw new Error("Failed to handle admin approval");
    }
}

/**
 * Processes multiple admin approval requests concurrently in batches of 5.
 *
 * Each approval is delegated to {@link handleAdminApproval}, ensuring that
 * all approval business logic, validation, transactions, and side effects
 * are handled consistently through the same execution path.
 *
 * Requires an authenticated and authorised admin user.
 *
 * @param inputs - Array of approval requests to process.
 * @returns A promise that resolves with an array of approval processing results
 * in the same order as the provided inputs.
 *
 * @throws Error If:
 * - The user is not authorised to perform approval actions.
 * - Any approval request fails to process.
 * - A database operation fails.
 */
export async function handleBulkAdminApproval(inputs: ApprovalInput[]) {
    try {
        await authorisedForApproval();

        const limit = pLimit(5);

        const results = await Promise.all(
            inputs.map((input) =>
                limit(() => handleAdminApproval(input))
            )
        );

        return results;
    } catch (error) {
        console.error("Error handling bulk admin approvals:", error);
        throw new Error("Failed to handle bulk admin approvals");
    }
}

/**
 * Retrieves a paginated list of tradie approval requests with optional
 * filtering by search term, approval type, and status.
 *
 * Search is performed against tradie name, trade, and email fields.
 * Results are returned in descending order of creation date.
 *
 * Decimal fields are converted to strings to ensure safe serialization.
 *
 * @param query - Query parameters used for filtering and pagination.
 * @returns A paginated collection of approval requests and pagination metadata.
 *
 * @throws Error If the approval records cannot be retrieved.
 */
export async function fetchTradieApprovals(query: TradieApprovalQuery): Promise<PaginatedTradieApprovals> {
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
        if (type) {
            whereClause.push({ actionType: type });
        }
        if (status) {
            whereClause.push({ status });
        }

        const [approvals, totalCount] = await Promise.all([
            prisma.tradieApproval.findMany({
                where: whereClause.length > 0 ? { AND: whereClause } : undefined,
                include: {
                    tradie: true,
                    user: true,
                },
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: {
                    createdAt: "desc",
                },
            }),
            prisma.tradieApproval.count({
                where: whereClause.length > 0 ? { AND: whereClause } : undefined,
            }),
        ]);

        const safeApprovals: SafeTradieApproval[] = approvals.map(approval => ({
            ...approval,
            updationData: approval.updationData as unknown as TradieApprovalPayload,
            tradie: {
                ...approval.tradie,
                lastQuotedPrice: approval.tradie.lastQuotedPrice?.toString(),
                rating: approval.tradie.rating?.toString(),
            },
            requestBy: approval.user.name,
        }));

        return {
            approvals: safeApprovals,
            totalCount,
            page,
            pageSize,
        };
    } catch (error) {
        console.error("Error fetching tradie approvals:", error);
        throw new Error("Error fetching tradie approvals");
    }
}

interface KPIResult {
    pendingCount: bigint;
    priceChangeCount: bigint;
    incidentReportCount: bigint;
    deletionCount: bigint;
    scheduleCount: bigint;
    scheduleDeletionCount: bigint;
    acceptedCount: bigint;
    rejectedCount: bigint;
}

/**
 * Retrieves approval dashboard KPI metrics.
 *
 * Metrics include:
 * - Total pending approvals.
 * - Pending price change requests.
 * - Pending incident resolution requests.
 * - Pending tradie removal requests.
 * - Pending schedule approval requests.
 * - Pending schedule deletion requests.
 * - Counts of approved and rejected approvals.
 *
 * All metrics are queried concurrently for improved performance.
 *
 * @returns Aggregated approval KPI statistics.
 *
 * @throws Error If KPI data cannot be retrieved.
 */
export async function fetchApprovalKPI(): Promise<ApprovalKPI> {
    try {
        const [result] = await prisma.$queryRaw<KPIResult[]>`
            SELECT
                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                ) AS "pendingCount",

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                    AND "actionType" = 'PRICE_CHANGE'
                ) AS "priceChangeCount",

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                    AND "actionType" = 'INCIDENT_RESOLUTION'
                ) AS "incidentReportCount",

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                    AND "actionType" = 'TRADIE_REMOVAL'
                ) AS "deletionCount",

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                    AND "actionType" = 'SCHEDULE_APPROVAL'
                ) AS "scheduleCount",

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                    AND "actionType" = 'SCHEDULE_DELETION'
                ) AS "scheduleDeletionCount",

                COUNT(*) FILTER (
                    WHERE status = 'APPROVED'
                ) AS "acceptedCount",

                COUNT(*) FILTER (
                    WHERE status = 'REJECTED'
                ) AS "rejectedCount"
            FROM "TradieApproval"
        `;

        return {
            pendingCount: Number(result.pendingCount),
            priceChangeCount: Number(result.priceChangeCount),
            incidentReportCount: Number(result.incidentReportCount),
            deletionCount: Number(result.deletionCount),
            scheduleCount: Number(result.scheduleCount),
            scheduleDeletionCount: Number(result.scheduleDeletionCount),
            resolvedCount: {
                accepted: Number(result.acceptedCount),
                rejected: Number(result.rejectedCount),
            },
        };
    } catch (error) {
        console.error("Error fetching approval KPI:", error);
        throw new Error("Error fetching approval KPI");
    }
}

/**
 * Retrieves approval KPI metrics using Next.js cache directives.
 *
 * Results are cached using the `approval-kpi` cache tag and the
 * configured medium cache profile to reduce database load.
 *
 * @returns Cached approval KPI statistics.
 */
export async function fetchApprovalKPICached(): Promise<ApprovalKPI> {
    'use cache';
    cacheTag(`approval-kpi`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return fetchApprovalKPI();
}

/**
 * Retrieves paginated tradie approval requests using Next.js cache directives.
 *
 * Results are cached using the `approval-query` cache tag and the
 * configured medium cache profile to improve performance for frequently
 * accessed approval listings.
 *
 * @param query - Query parameters used for filtering and pagination.
 * @returns Cached paginated approval results.
 */
export async function fetchTradieApprovalsCached(query: TradieApprovalQuery): Promise<PaginatedTradieApprovals> {
    'use cache';
    cacheTag(`approval-query`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return fetchTradieApprovals(query);
}