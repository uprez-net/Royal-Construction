'use server';
import { CreateTradieInput, DeleteInput, RatingInput, TradieDetails, TradieRow, TradiesByCategory, UpdatePriceInput } from "@/types/tradie";
import prisma from "../prisma";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "./user";
import { TradieApprovalActionType } from "@prisma/client";

export async function createTradie(input: CreateTradieInput): Promise<TradieRow> {
    try {
        const res = await prisma.tradie.create({
            data: input
        });

        return {
            id: res.id,
            name: res.name,
            trade: res.trade,
            isFavourite: res.isFavourite,
            hourlyRate: res.hourlyRate ? res.hourlyRate.toString() : null,
            rating: res.rating ? res.rating.toString() : null,
            jobsCompleted: 0,
            incidentCount: {
                open: 0,
                resolved: 0
            }
        };
    } catch (error) {
        console.error("Error creating tradie:", error);
        throw new Error("Failed to create tradie");
    }
}

export async function getTradieById(tradieId: string): Promise<TradieDetails | null> {
    try {
        const tradie = await prisma.tradie.findUnique({
            where: { id: tradieId },
            include: {
                ratings: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                incidents: true,
                schedules: {
                    select: {
                        id: true,
                        status: true
                    },
                    where: {
                        status: "COMPLETED"
                    }
                }
            }
        });

        if (!tradie) {
            return null;
        }

        return {
            ...tradie,
            hourlyRate: tradie.hourlyRate?.toString(),
            rating: tradie.rating?.toString(),
            jobsCompleted: tradie.schedules.length,
            reviews: tradie.ratings.map(r => ({
                ...r,
                rating: r.rating.toString(),
                user: {
                    id: r.user.id,
                    name: r.user.name
                }
            })),
            incidents: tradie.incidents
        };
    } catch (error) {
        console.error("Error fetching tradie details:", error);
        return null;
    }
}

export async function updateTradiePrice(input: UpdatePriceInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }

        await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.PRICE_CHANGE,
                reason: input.reason,
                updationData: {
                    newHourlyRate: input.newHourlyRate,
                }
            }
        })
    } catch (error) {
        console.error("Error updating tradie price:", error);
        throw new Error("Failed to update tradie price");
    }
}

export async function deleteTradie(input: DeleteInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }
        await prisma.tradieApproval.create({
            data: {
                tradieId: input.tradieId,
                actionType: TradieApprovalActionType.TRADIE_REMOVAL,
                reason: input.reason,
            }
        })
    } catch (error) {
        console.error("Error deleting tradie:", error);
        throw new Error("Failed to delete tradie");
    }
}

export async function rateTradie(input: RatingInput) {
    try {
        const { userId } = await auth()
        if (!userId) {
            throw new Error("User not authenticated");
        }
        const user = await getUserByClerkIdCached(userId);
        if (!user) {
            throw new Error("User not found");
        }
        const tradie = await prisma.tradie.findUnique({
            where: { id: input.tradieId }
        });

        if (!tradie) {
            throw new Error("Tradie not found");
        }

        await prisma.tradieRating.create({
            data: {
                tradieId: input.tradieId,
                userId: user.id,
                rating: input.rating,
                comment: input.comment
            }
        });

        const avgRating = await prisma.tradieRating.aggregate({
            where: { tradieId: input.tradieId },
            _avg: {
                rating: true
            }
        });

        await prisma.tradie.update({
            where: { id: input.tradieId },
            data: {
                rating: avgRating._avg.rating ?? 0
            }
        });

        return {
            id: tradie.id,
            newRating: (avgRating._avg.rating ?? 0).toString()
        }
    } catch (error) {
        console.error("Error rating tradie:", error);
        throw new Error("Failed to rate tradie");
    }
}

// export async function getTradieGroupedByCategory(): Promise<TradiesByCategory[]> {
//     try {
//         const tradies
//     } catch (error) {
//         console.error("Error fetching tradies grouped by category:", error);
//         throw new Error("Failed to fetch tradies grouped by category");
//     }
// }