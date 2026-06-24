'use server';
import prisma from "../prisma";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";
import { after } from "next/server"
import { ApprovalInput, IncidentReportApprovalPayload, SafeTradieApproval, UpdatePriceApprovalPayload } from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

/**
 * Ensures the currently authenticated user is authorized to perform
 * administrative approval actions.
 *
 * Validates that:
 * - A user is authenticated via Clerk.
 * - The authenticated user exists in the application database.
 * - The user matches the configured admin user ID.
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
    if (!user || user.id !== ADMIN_USER_ID) {
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
            },
        });

        if (!approval) {
            throw new Error("Approval request not found");
        }

        return {
            ...approval,
            tradie: {
                ...approval.tradie,
                hourlyRate: approval.tradie.hourlyRate?.toString(),
                rating: approval.tradie.rating?.toString(),
            },
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
            where: { id: input.approvalId }
        });
        if (!approval) {
            throw new Error("Approval request not found");
        }

        after(() => {
            revalidateTag(`tradie-${approval.tradieId}`, CACHE_PROFILES.MEDIUM);
            revalidateTag('tradie-management', CACHE_PROFILES.MEDIUM);
        });

        switch (input.type) {
            case TradieApprovalActionType.PRICE_CHANGE: {
                const payload = input.payload as UpdatePriceApprovalPayload;
                const isApproved = input.resolution === "approved";
                await prisma.tradie.update({
                    where: { id: approval.tradieId },
                    data: {
                        hourlyRate: isApproved ? payload.newHourlyRate : undefined
                    }
                });
                return {
                    actionType: TradieApprovalActionType.PRICE_CHANGE,
                    tradieId: approval.tradieId,
                    newHourlyRate: isApproved ? payload.newHourlyRate : undefined,
                    resolution: input.resolution
                }
            }
            case TradieApprovalActionType.TRADIE_REMOVAL: {
                const isApproved = input.resolution === "approved";
                if (isApproved) {
                    await prisma.tradie.delete({
                        where: { id: approval.tradieId }
                    });
                }
                return {
                    actionType: TradieApprovalActionType.TRADIE_REMOVAL,
                    tradieId: approval.tradieId,
                    resolution: input.resolution
                };
            }
            case TradieApprovalActionType.INCIDENT_RESOLUTION: {
                const payload = input.payload as IncidentReportApprovalPayload;
                const incidentData = approval.updationData as {
                    incidentId: string;
                };
                const isApproved = input.resolution === "approved";
                // Handle incident resolution logic here
                const updatedIncident = await prisma.tradieIncident.update({
                    where: { id: incidentData.incidentId },
                    data: {
                        resolution: payload.resolution,
                        status: isApproved ? "RESOLVED" : "OPEN"
                    }
                });

                return {
                    actionType: TradieApprovalActionType.INCIDENT_RESOLUTION,
                    tradieId: approval.tradieId,
                    incidentId: updatedIncident.id,
                    updatedIncident,
                }
            }
            default:
                throw new Error("Unknown approval action type");
        }
    } catch (error) {
        console.error("Error handling admin approval:", error);
        throw new Error("Failed to handle admin approval");
    }
}
