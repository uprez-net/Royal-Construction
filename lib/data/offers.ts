"use server";
import { Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { startOfWeek, subWeeks } from "date-fns";
import { OfferKPIs, OfferWithItemsAndFiles, OfferWithLead, PaginatedOfferResult, SafeOfferDBFile, SafeOfferItem } from "@/types/offer";
import type { OfferFile } from "@/context/ChatContext";
import { findLeadById } from "./leads";
import { offerCreationAgent } from "../agent/offerCreationAgent";
import { v4 as uuidv4 } from "uuid";
import { buildCreationStarterPrompt, FacadeOptionWithImageUrl } from "../agent/offer-prompts";
import { triggerNotification } from "@/lib/notification/novu";
import { createNotification } from "@/types/notification";
import { imageGenerationAgent } from "../agent/imageGenerationAgent";

export async function getOffers(page?: number, limit?: number, q?: string): Promise<PaginatedOfferResult> {
    const safePage = Number.isFinite(page) && (page ?? 1) > 0 ? Math.floor(page ?? 1) : 1;
    const safeLimit = Number.isFinite(limit) && (limit ?? 12) > 0 ? Math.min(Math.floor(limit ?? 12), 100) : 12;
    const safeQuery = (q && q.trim() !== "") ? q.trim() : undefined;
    try {
        const whereClause: Prisma.OfferWhereInput[] = [];
        if (safeQuery) {
            whereClause.push({
                OR: [
                    {
                        lead: {
                            name: { contains: safeQuery, mode: "insensitive" },
                            email: { contains: safeQuery, mode: "insensitive" },
                            phone: { contains: safeQuery, mode: "insensitive" },
                            location: { contains: safeQuery, mode: "insensitive" },
                        }
                    }
                ],
            });
        }
        const [offers, totalCount] = await Promise.all([
            prisma.offer.findMany({
                where: { AND: whereClause },
                include: {
                    lead: true,
                    offerFiles: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        select: {
                            version: true,
                        }
                    },
                },
                skip: (safePage - 1) * safeLimit,
                take: safeLimit,
            }),
            prisma.offer.count({
                where: { AND: whereClause },
            }),
        ]);
        const totalPages = Math.ceil(totalCount / safeLimit);

        return {
            items: offers.map(({ offerFiles, ...offer }) => ({
                ...offer,
                amount: offer.amount.toString(),
                gstAmount: offer.gstAmount.toString(),
                totalAmount: offer.totalAmount.toString(),
                version: offerFiles[0]?.version ?? 1,
            })),
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages,
        };
    } catch (error) {
        console.error("Error fetching offers:", error);
        return {
            items: [],
            page: safePage,
            limit: safeLimit,
            totalCount: 0,
            totalPages: 1,
        };
    }
}

export async function getOfferByLeadId(id: number): Promise<OfferWithItemsAndFiles | null> {
    try {
        const offerData = await prisma.offer.findUnique({
            where: { leadId: id },
            include: {
                lead: true,
                offerItems: true,
                offerFiles: true,
            },
        });


        if (!offerData) {
            console.warn(`No offer found for lead ID: ${id}`);
            return null;
        }

        const { offerItems, offerFiles, ...offer } = offerData;
        const currentVersion = offerItems.reduce((max, item) => Math.max(max, item.version), 0) ?? 0;
        const offerItemsRecord: Record<number, SafeOfferItem[]> = {};
        const filesRecord: Record<number, SafeOfferDBFile> = {};
        offerItems.forEach(item => {
            if (!offerItemsRecord[item.version]) {
                offerItemsRecord[item.version] = [];
            }
            offerItemsRecord[item.version].push({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            });
        });
        offerFiles.forEach(file => {
            filesRecord[file.version] = {
                ...file,
                offerContent: file.offerContent as OfferFile,
            };
        });

        return {
            ...offer,
            amount: offer.amount.toString(),
            gstAmount: offer.gstAmount.toString(),
            totalAmount: offer.totalAmount.toString(),
            version: currentVersion,
            items: offerItemsRecord,
            files: filesRecord,
        };
    } catch (error) {
        console.error("Error fetching offer by ID:", error);
        throw error;
    }
}

function calculateTrend(current: number, previous: number) {
    if (previous === 0) {
        return current > 0 ? 100 : 0;
    }

    return ((current - previous) / previous) * 100;
}

export async function getOfferKPIs(): Promise<OfferKPIs> {
    try {
        const now = new Date();

        const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const [
            allOffers,

            pendingOffers,
            approvedOffers,
            rejectedOffers,
            sentOffers,

            allPreviousWeek,
            allCurrentWeek,

            pendingPreviousWeek,
            pendingCurrentWeek,

            approvedPreviousWeek,
            approvedCurrentWeek,

            rejectedPreviousWeek,
            rejectedCurrentWeek,

            sentPreviousWeek,
            sentCurrentWeek,
        ] = await Promise.all([
            // Totals
            prisma.offer.count(),

            prisma.offer.count({
                where: { offerStatus: "PENDING" },
            }),
            prisma.offer.count({
                where: { offerStatus: "ACCEPTED" },
            }),
            prisma.offer.count({
                where: { offerStatus: "REJECTED" },
            }),
            prisma.offer.count({
                where: { offerStatus: "SENT" },
            }),

            // All Offers Trend (created this week vs last week)
            prisma.offer.count({
                where: {
                    createdAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    createdAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Pending Trend
            prisma.offer.count({
                where: {
                    offerStatus: "PENDING",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "PENDING",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Approved Trend
            prisma.offer.count({
                where: {
                    offerStatus: "ACCEPTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "ACCEPTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Rejected Trend
            prisma.offer.count({
                where: {
                    offerStatus: "REJECTED",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "REJECTED",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),

            // Sent Trend
            prisma.offer.count({
                where: {
                    offerStatus: "SENT",
                    updatedAt: {
                        gte: previousWeekStart,
                        lt: currentWeekStart,
                    },
                },
            }),
            prisma.offer.count({
                where: {
                    offerStatus: "SENT",
                    updatedAt: {
                        gte: currentWeekStart,
                    },
                },
            }),
        ]);

        return {
            allOffers: {
                total: allOffers,
                trendDelta: calculateTrend(allCurrentWeek, allPreviousWeek),
            },
            pendingOffers: {
                total: pendingOffers,
                trendDelta: calculateTrend(
                    pendingCurrentWeek,
                    pendingPreviousWeek,
                ),
            },
            approvedOffers: {
                total: approvedOffers,
                trendDelta: calculateTrend(
                    approvedCurrentWeek,
                    approvedPreviousWeek,
                ),
            },
            rejectedOffers: {
                total: rejectedOffers,
                trendDelta: calculateTrend(
                    rejectedCurrentWeek,
                    rejectedPreviousWeek,
                ),
            },
            sentOffers: {
                total: sentOffers,
                trendDelta: calculateTrend(
                    sentCurrentWeek,
                    sentPreviousWeek,
                ),
            },
        };
    } catch (error) {
        console.error("Error fetching offer KPIs:", error);

        return {
            allOffers: { total: 0, trendDelta: 0 },
            pendingOffers: { total: 0, trendDelta: 0 },
            approvedOffers: { total: 0, trendDelta: 0 },
            rejectedOffers: { total: 0, trendDelta: 0 },
            sentOffers: { total: 0, trendDelta: 0 },
        };
    }
}

export const getOffersCached = async (page?: number, limit?: number, q?: string) => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOffers(page, limit, q);
}

export const getOfferByLeadIdCached = async (id: number) => {
    "use cache";
    cacheTag(`offer-${id}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferByLeadId(id);
}

export const getOfferKPIsCached = async () => {
    "use cache";
    cacheTag("offers");
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getOfferKPIs();
}

interface CreateOfferInput {
    leadId: number;
    offerFileInput: {
        id: string;
        filename: string;
        fileType: string;
        filesize: number;
        url: string;
        offerContent: OfferFile;
    };
    amount: string;
    gstAmount: string;
    totalAmount: string;
    offerItems: {
        id: string;
        item: string;
        description: string;
        quantity: number;
        unitPrice: string;
        totalPrice: string;
        unit: string;
    }[];
}

export const createOrUpdateOffer = async ({
    leadId,
    offerFileInput,
    amount,
    gstAmount,
    totalAmount,
    offerItems
}: CreateOfferInput) => {
    try {
        const version = await prisma.offerFile.count({
            where: { offer: { leadId } },
        }) + 1;
        const newOffer = await prisma.offer.upsert({
            where: { leadId },
            update: {
                amount: new Prisma.Decimal(amount),
                gstAmount: new Prisma.Decimal(gstAmount),
                totalAmount: new Prisma.Decimal(totalAmount),
            },
            create: {
                leadId,
                amount: new Prisma.Decimal(amount),
                gstAmount: new Prisma.Decimal(gstAmount),
                totalAmount: new Prisma.Decimal(totalAmount),
            },
            include: {
                lead: true,
            }
        });

        const newOfferFile = await prisma.offerFile.create({
            data: {
                id: offerFileInput.id,
                offerId: newOffer.id,
                filename: offerFileInput.filename,
                fileType: offerFileInput.fileType,
                filesize: offerFileInput.filesize,
                url: offerFileInput.url,
                offerContent: offerFileInput.offerContent as Prisma.InputJsonValue,
                version: version,
            },
        });

        const offerItemsData = await prisma.offerItem.createManyAndReturn({
            data: offerItems.map(item => ({
                id: item.id,
                offerId: newOffer.id,
                item: item.item,
                description: item.description,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(item.unitPrice),
                totalPrice: new Prisma.Decimal(item.totalPrice),
                unit: item.unit,
                version: version,
            })),
        });

        revalidateTag("offers", CACHE_PROFILES.MEDIUM);
        revalidateTag(`offer-${newOffer.id}`, CACHE_PROFILES.MEDIUM);

        return {
            ...newOffer,
            amount: newOffer.amount.toString(),
            gstAmount: newOffer.gstAmount.toString(),
            totalAmount: newOffer.totalAmount.toString(),
            version: version,
            newOfferItems: offerItemsData.map(item => ({
                ...item,
                unitPrice: item.unitPrice.toString(),
                totalPrice: item.totalPrice.toString(),
            })) ?? [],
            newOfferFile: {
                ...newOfferFile,
                offerContent: newOfferFile.offerContent as OfferFile,
            },
        };
    } catch (error) {
        console.error("Error creating offer:", error);
        throw new Error("Failed to create offer");
    }
}

const DEFAULT_GST_RATE = 0.10;

function roundCurrency(value: number) {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function calculateLinePricing(item: { unitPrice: number; quantity: number; gstRate?: number; gstIncluded?: boolean }) {
    const gstRate = item.gstRate ?? DEFAULT_GST_RATE;
    const rawLine = roundCurrency(item.unitPrice * item.quantity);

    if (item.gstIncluded) {
        const netLine = roundCurrency(rawLine / (1 + gstRate));
        return {
            netLine,
            gstAmount: roundCurrency(rawLine - netLine),
            totalPrice: rawLine,
        };
    }

    const gstAmount = roundCurrency(rawLine * gstRate);
    return {
        netLine: rawLine,
        gstAmount,
        totalPrice: roundCurrency(rawLine + gstAmount),
    };
}

export const createOffer = async (leadId: number): Promise<OfferWithLead> => {
    try {
        const lead = await findLeadById(leadId);
        if (!lead) {
            throw new Error(`Lead with ID ${leadId} not found`);
        }
        const leadFiles = await prisma.file.findMany({
            where: { leadId }
        });
        const prompt = buildCreationStarterPrompt(lead, leadFiles);
        const { output } = await offerCreationAgent.generate({
            prompt,
        });
        const offerItemsWithPricing = output.lineItemArray.map((item) => ({
            item,
            pricing: calculateLinePricing(item),
        }));
        const amount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.netLine, 0));
        const gstAmount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.gstAmount, 0));
        const totalAmount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.totalPrice, 0));
        const Options: FacadeOptionWithImageUrl["options"] = [];
        if (output.offerFileContent.facadeOptions) {
            for (const option of output.offerFileContent.facadeOptions.options) {
                const image = await imageGenerationAgent.generate({
                    prompt: 
                    `
                        Generate a facade design image based on the following description: ${option.description}. 
                        The image should reflect the architectural style, materials, colors, and specific features mentioned in the description.
                    `
                })
                Options.push({
                    ...option,
                    imageUrl: image.output.imageUrl,
                })
            }
        }

        const { newOfferItems, newOfferFile, ...newOffer } = await createOrUpdateOffer({
            leadId,
            offerFileInput: {
                id: uuidv4(),
                filename: `offer_${lead.name}_${Date.now()}.json`,
                fileType: "application/json",
                filesize: JSON.stringify(output.offerFileContent).length,
                url: "placeholder_url", // In a real implementation, you would upload the content to a storage service and provide the URL here
                offerContent: {
                    ...output.offerFileContent,
                    facadeOptions: output.offerFileContent.facadeOptions ? {
                        optionsDescription: output.offerFileContent.facadeOptions.optionsDescription,
                        options: Options,
                    } : undefined,
                },
            },
            amount: amount.toString(),
            gstAmount: gstAmount.toString(),
            totalAmount: totalAmount.toString(),
            offerItems: offerItemsWithPricing.map(({ item, pricing }) => ({
                id: item.id,
                item: item.item,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toString(),
                totalPrice: pricing.totalPrice.toString(),
                unit: item.unit,
            })),
        });
        await prisma.chatSession.create({
            data: {
                leadId,
            },
        });

        const notificationPayload = createNotification("offerCreated", {
            offerId: newOffer.id.toString(),
            leadId: leadId.toString(),
            offerAmount: totalAmount.toString(),
            offerStatus: newOffer.offerStatus,
        });
        await triggerNotification(lead.assignedId ? [lead.assignedId] : [], notificationPayload);

        revalidateTag("offers", CACHE_PROFILES.MEDIUM);
        revalidateTag(`offer-${newOffer.id}`, CACHE_PROFILES.MEDIUM);

        return {
            ...newOffer,
        };
    } catch (error) {
        console.error("Error creating offer:", error);
        throw new Error(`Failed to create offer${error instanceof Error ? `: ${error.message}` : ""}`);
    }
}