import { OfferWithLead } from "@/types/offer";
import { prisma } from "@/lib/prisma";
import { buildCreationStarterPrompt, FacadeOptionWithImageUrl } from "@/lib/agent/offer-prompts";
import { findLeadById } from "@/lib/data/leads";
import { handleOfferFileGeneration, handleOfferLineItemGeneration } from "@/lib/agent/offerCreationAgent";
import { v4 as uuidv4 } from "uuid";
import { createOrUpdateOffer } from "@/lib/data/offers";
import { OfferCreationOutput } from "@/lib/agent/offer-prompts";
import { Lead } from "@/lib/leads/types";
import { createNotification } from "@/types/notification";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { getWritable } from "workflow";
import { currency } from "@/utils/formatters";
import { RunStatus } from "@prisma/client";
import { put } from "@vercel/blob";

export interface OfferCreationStatus {
    failed?: boolean;
    status: "FETCHING_DETAILS" | "BUILDING_OFFER" | "SAVING_OFFER" | "TRIGGERING_NOTIFICATION" | "COMPLETED";
    progress: number;
    message: {
        step: "FETCHING_DETAILS" | "BUILDING_OFFER" | "SAVING_OFFER" | "TRIGGERING_NOTIFICATION" | "COMPLETED";
        details?: string;
    }[];
}

function sanitizeOfferFilename(name: string) {
    const safeName = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);

    return safeName || "offer";
}

export const createOfferWorkflow = async (leadId: number): Promise<OfferWithLead> => {
    'use workflow';
    try {
        // Start of workflow - send initial status
        await writeToStream({
            status: "FETCHING_DETAILS",
            progress: 0,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Starting offer creation workflow for lead ID ${leadId}`,
                }
            ]
        });
        // Fetching lead details step
        const { lead, prompt } = await findLead(leadId);

        //Processing details step
        const { offerItemsWithPricing, amount, gstAmount, totalAmount, output: lineItemOutput } = await buildOfferLineItems(prompt, lead);
        
        const offerCreationPrompt = `
        ## Created Line Items:
        ${lineItemOutput.lineItemArray.map(item =>
            `- ${item.item} - (${item.description}): ${item.quantity} ${item.unit} at $${item.unitPrice} each (GST ${item.gstIncluded ? "included" : "excluded"})`).join("\n")
            }

        ${prompt}
        `
        const { output: fileOutput, Options } = await buildOfferFile(offerCreationPrompt, lead);

        // Creating offer step
        const newOffer = await saveOffer({
            lead,
            output: {
                lineItemArray: lineItemOutput.lineItemArray,
                offerFileContent: fileOutput.offerFileContent,
            },
            offerItemsWithPricing,
            Options,
            amount,
            gstAmount,
            totalAmount,
        });

        // Trigger notification step
        await triggerNotificationStep(newOffer, totalAmount);

        return {
            ...newOffer,
        };
    } catch (error) {
        console.error("Error creating offer:", error);
        await failWorkflow(error instanceof Error ? error.message : "Unknown error", leadId);
        throw new Error(`Failed to create offer${error instanceof Error ? `: ${error.message}` : ""}`);
    }
}

// Utility functions

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

// Steps Functions

async function findLead(leadId: number) {
    'use step';
    try {
        const lead = await findLeadById(leadId);
        if (!lead) {
            throw new Error(`Lead with ID ${leadId} not found`);
        }
        const leadFiles = await prisma.file.findMany({
            where: { leadId }
        });
        const prompt = buildCreationStarterPrompt(lead, leadFiles);

        await writeToStream({
            status: "BUILDING_OFFER",
            progress: 25,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                }
            ],
        });

        return { lead, prompt };
    } catch (error) {
        console.error(`Error fetching lead with ID ${leadId}:`, error);
        await writeToStream({
            failed: true,
            status: "FETCHING_DETAILS",
            progress: 0,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Failed to fetch details for lead with ID ${leadId}${error instanceof Error ? `: ${error.message}` : ""}`,
                }
            ],
        });
        throw new Error(`Failed to fetch lead with ID`);
    }
}

async function buildOfferLineItems(prompt: string, lead: Lead) {
    'use step';
    try {
        const output = await handleOfferLineItemGeneration(prompt);
        const offerItemsWithPricing = output.lineItemArray.map((item) => ({
            item,
            pricing: calculateLinePricing(item),
        }));
        const amount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.netLine, 0));
        const gstAmount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.gstAmount, 0));
        const totalAmount = roundCurrency(offerItemsWithPricing.reduce((sum, { pricing }) => sum + pricing.totalPrice, 0));

        console.log(`Built offer with message: ${output.creationMessage}, total amount: $${totalAmount}`);
        await writeToStream({
            status: "SAVING_OFFER",
            progress: 45,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built ${offerItemsWithPricing.length} line items, total amount: $${totalAmount}`,
                }
            ],
        });

        return {
            offerItemsWithPricing,
            amount,
            gstAmount,
            totalAmount,
            output,
        };
    } catch (error) {
        console.error("Error building offer:", error);
        await writeToStream({
            status: "BUILDING_OFFER",
            progress: 25,
            failed: true,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Failed to build offer${error instanceof Error ? `: ${error.message}` : ""}`,
                }
            ],
        });
        throw new Error(`Failed to build offer`);
    }
}

async function buildOfferFile(prompt: string, lead: Lead) {
    'use step';
    try {
        const output = await handleOfferFileGeneration(prompt);
        const Options: FacadeOptionWithImageUrl["options"] = output.offerFileContent.facadeOptions ? output.offerFileContent.facadeOptions.options : [];

        console.log(`Built offer file with message: ${output.creationMessage}`);
        await writeToStream({
            status: "SAVING_OFFER",
            progress: 65,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built offer file with message: ${output.creationMessage}`,
                }
            ],
        });

        return {
            output,
            Options,
        };
    } catch (error) {
        console.error("Error building offer file:", error);
        await writeToStream({
            status: "BUILDING_OFFER",
            progress: 45,
            failed: true,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Failed to build offer file${error instanceof Error ? `: ${error.message}` : ""}`,
                }
            ],
        });
        throw new Error(`Failed to build offer file`);
    }
}

type OfferLineItemPricing = {
    item: {
        id: string;
        item: string;
        description: string;
        unitPrice: number;
        quantity: number;
        unit: string;
        gstRate?: number | undefined;
        gstIncluded?: boolean | undefined;
        source?: string | undefined;
    };
    pricing: {
        netLine: number;
        gstAmount: number;
        totalPrice: number;
    };
};

async function saveOffer({
    lead,
    output,
    offerItemsWithPricing,
    Options,
    amount,
    gstAmount,
    totalAmount,
}: {
    lead: Lead;
    output: OfferCreationOutput;
    offerItemsWithPricing: OfferLineItemPricing[];
    Options: FacadeOptionWithImageUrl["options"];
    amount: number;
    gstAmount: number;
    totalAmount: number;

}) {
    'use step';
    try {
        const offerFileContent = {
            ...output.offerFileContent,
            facadeOptions: output.offerFileContent.facadeOptions ? {
                optionsDescription: output.offerFileContent.facadeOptions.optionsDescription,
                options: Options,
            } : undefined,
        };
        const offerFileJson = JSON.stringify(offerFileContent);
        const filename = `offer_${sanitizeOfferFilename(lead.name)}_${Date.now()}.json`;
        const blob = await put(
            `offer-files/${lead.id}/${filename}`,
            offerFileJson,
            {
                access: "public",
                addRandomSuffix: true,
                contentType: "application/json",
            },
        );

        const newOffer = await createOrUpdateOffer({
            leadId: lead.id,
            offerFileInput: {
                id: uuidv4(),
                filename,
                fileType: "application/json",
                filesize: Buffer.byteLength(offerFileJson, "utf8"),
                url: blob.url,
                offerContent: offerFileContent,
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

        const existingChatSession = await prisma.chatSession.findFirst({
            where: { leadId: lead.id },
            select: { id: true },
        });
        if (!existingChatSession) {
            await prisma.chatSession.create({
                data: {
                    leadId: lead.id,
                },
            });
        }

        await prisma.lead.update({
            where: { id: lead.id },
            data: {
                runStatus: RunStatus.COMPLETED,
            },
        });

        await writeToStream({
            status: "TRIGGERING_NOTIFICATION",
            progress: 75,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built offer with ${offerItemsWithPricing.length} line items, total amount: $${totalAmount}`,
                },
                {
                    step: "SAVING_OFFER",
                    details: `Saved offer with ID ${newOffer.id} for lead ${lead.name} (ID: ${lead.id})`,
                },
            ]

        });

        return newOffer;
    } catch (error) {
        console.error("Error saving offer:", error);
        await writeToStream({
            status: "SAVING_OFFER",
            progress: 65,
            failed: true,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${lead.name} (ID: ${lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built offer with ${offerItemsWithPricing.length} line items, total amount: $${totalAmount}`,
                },
                {
                    step: "SAVING_OFFER",
                    details: `Failed to save offer${error instanceof Error ? `: ${error.message}` : ""}`,
                },
            ]
        });
        throw new Error(`Failed to save offer`);
    }
}

async function triggerNotificationStep(offer: OfferWithLead, totalAmount: number) {
    'use step';
    try {
        const notificationPayload = createNotification("offerCreated", {
            offerId: offer.id,
            leadId: offer.leadId.toString(),
            offerAmount: totalAmount.toString(),
            offerStatus: offer.offerStatus,
        });
        await triggerNotification(offer.lead.assignedId ? [offer.lead.assignedId] : [], notificationPayload);

        revalidateTag("offers", CACHE_PROFILES.MEDIUM);
        revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.MEDIUM);
        revalidateTag(`offer-lead-${offer.leadId}`, CACHE_PROFILES.MEDIUM);

        await writeToStream({
            status: "COMPLETED",
            progress: 100,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${offer.lead.name} (ID: ${offer.lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built offer with, total amount: ${currency.format(totalAmount)}`,
                },
                {
                    step: "SAVING_OFFER",
                    details: `Saved offer with ID ${offer.id} for lead ${offer.lead.name} (ID: ${offer.lead.id})`,
                },
                {
                    step: "COMPLETED",
                    details: `Offer creation completed and notification triggered for offer ID ${offer.id}`,
                },
            ]
        });
    } catch (error) {
        console.error("Error triggering notification:", error);
        await writeToStream({
            status: "TRIGGERING_NOTIFICATION",
            progress: 75,
            failed: true,
            message: [
                {
                    step: "FETCHING_DETAILS",
                    details: `Fetched details for lead ${offer.lead.name} (ID: ${offer.lead.id})`,
                },
                {
                    step: "BUILDING_OFFER",
                    details: `Built offer with, total amount: ${currency.format(totalAmount)}`,
                },
                {
                    step: "SAVING_OFFER",
                    details: `Saved offer with ID ${offer.id} for lead ${offer.lead.name} (ID: ${offer.lead.id})`,
                },
                {
                    step: "TRIGGERING_NOTIFICATION",
                    details: `Failed to trigger notification for offer ID ${offer.id}${error instanceof Error ? `: ${error.message}` : ""}`,
                },
            ]
        });
        return;
    }
}

async function failWorkflow(message: string, leadId: number) {
    'use step';
    try {
        console.error(`Workflow failed: ${message}`);
        const updatedLead = await prisma.lead.update({
            where: { id: leadId },
            data: {
                runStatus: RunStatus.FAILED, // Update run status to FAILED
            }
        });

        const notificationPayload = createNotification("offerGenerationFailed", {
            leadId: leadId.toString(),
            errorMessage: message,
        });
        await triggerNotification(updatedLead.assignedId ? [updatedLead.assignedId] : [], notificationPayload);
    } catch (error) {
        console.error("Error in failWorkflow:", error);
        console.error(`Failed to update lead status for lead ID: ${leadId}`);
    }
}

async function writeToStream(data: OfferCreationStatus) {
    "use step";
    // Stream operations must happen in steps
    const writable = getWritable<OfferCreationStatus>();
    const writer = writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
}
