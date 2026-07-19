'use server';
import { Output, stepCountIs, NoObjectGeneratedError, TypeValidationError, generateText, tool } from "ai";
import { gateway } from "@/lib/model";
import z from "zod";
import { LEAD_INFO_TO_PROJECT_INFERENCE_PROMPT } from "./project-prompt";
import prisma from "@/lib/prisma";
import type { OfferFile } from "@/types/offer-content";


const MODEL_NAME = "google/gemini-2.5-flash" as const;

const projectSpecsSchema = z.object({
    projectDescription: z.string().describe("A detailed description of the project, including its purpose, scope, and any relevant context. This should be inferred from the offer details."),
    projectType: z.string().describe("The type of the project, e.g., granny flat, extension, etc."),
    projectBudget: z.number().describe("The budget for the project should not be a range should be a specific amount. this should be the estimate of what it would cost to build this project infer this from the offer details, e.g., 50,000"),
    projectRequirements: z.array(z.string()).min(2).describe("A list of specific requirements or features for the project infer this from the offer details should have atleast 2 requirements, e.g., 2 bedrooms, 1 bathroom, open-plan kitchen."),
});

type ProjectSpecs = z.infer<typeof projectSpecsSchema>;

const fetchAdditionalOfferInfoTool = tool({
    description: "Fetches additional offer information from the database based on the provided lead ID.",
    inputSchema: z.object({
        leadId: z.number().describe("The ID of the lead for which to fetch additional offer information."),
    }),
    execute: async ({ leadId }) => {
        try {
            // A Lead can now have many offer revisions; use the active one.
            const offerData = await prisma.offer.findFirst({
                where: { leadId, isActive: true },
                orderBy: { createdAt: "desc" },
                include: {
                    offerItems: true,
                    offerFiles: true,
                },
            });

            if (!offerData) {
                console.warn(`No offer found for lead ID: ${leadId}`);
                throw new Error(`No offer found for lead ID: ${leadId}`);
            }
            const { offerItems, offerFiles, ...offer } = offerData;
            const currentVersion = offerFiles.reduce((max, file) => Math.max(max, file.version), 0);

            return {
                ...offer,
                amount: offer.amount.toString(),
                gstAmount: offer.gstAmount.toString(),
                totalAmount: offer.totalAmount.toString(),
                version: currentVersion,
                lineItems: offerItems,
                offerFilesContent: offerFiles.map(file => ({
                    version: file.version,
                    ...(file.offerContent as OfferFile),
                })),
            };
        } catch (error) {
            console.error(`Error fetching additional offer info for lead ID ${leadId}:`, error);
            throw new Error(`Failed to fetch additional offer info for lead ID ${leadId}`);
        }
    }
})

const fetchAdditionalLeadInfoTool = tool({
    description: "Fetches additional lead information from the database based on the provided lead ID.",
    inputSchema: z.object({
        leadId: z.number().describe("The ID of the lead for which to fetch additional information."),
    }),
    execute: async ({ leadId }) => {
        const leadInfo = await prisma.lead.findUnique({
            where: { id: leadId },
            include: {
                history: {
                    orderBy: { actionDate: "asc" }
                },
                chatSessions: true,
                assignedUser: { select: { id: true, name: true, email: true } },
                noteAnnotations: { orderBy: { createdAt: "desc" } },
                emails: { orderBy: { createdAt: "desc" } },
            }
        });

        if (!leadInfo) {
            throw new Error(`No lead information found for lead ID: ${leadId}`);
        }
        return leadInfo;
    }
});

export const handleProjectSpecsGeneration = async (prompt: string): Promise<ProjectSpecs> => {
    try {
        const { output } = await generateText({
            model: gateway(MODEL_NAME),
            temperature: 0.15,
            stopWhen: stepCountIs(3),
            system: LEAD_INFO_TO_PROJECT_INFERENCE_PROMPT,
            tools: {
                fetchAdditionalLeadInfo: fetchAdditionalLeadInfoTool,
                fetchAdditionalOfferInfo: fetchAdditionalOfferInfoTool,
            },
            toolChoice: "auto",
            output: Output.object({
                schema: projectSpecsSchema,
            }),
            prompt,
        });

        return output;
    } catch (error) {
        if (error instanceof NoObjectGeneratedError) {
            throw new Error("Failed to generate project specifications. The AI did not return a valid object.");
        }
        if (error instanceof TypeValidationError) {
            throw new Error(`Failed to validate the generated project specifications. ${error.message}`);
        }
        throw error;
    }

}