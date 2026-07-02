'use server';
import { Output, stepCountIs, NoObjectGeneratedError, TypeValidationError, generateText, tool } from "ai";
import { gateway } from "@/lib/model";
import z from "zod";
import { LEAD_INFO_TO_PROJECT_INFERENCE_PROMPT } from "./project-prompt";
import prisma from "@/lib/prisma";
import type { OfferFile } from "@prisma/client";


const MODEL_NAME = "google/gemini-2.5-flash" as const;

const projectSpecsSchema = z.object({
    projectType: z.string().describe("The type of the project, e.g., granny flat, extension, etc."),
    projectBudget: z.number().describe("The budget for the project should not be a range should be a specific amount, e.g., 50,000"),
    projectRequirements: z.array(z.string()).describe("A list of specific requirements or features for the project, e.g., 2 bedrooms, 1 bathroom, open-plan kitchen."),
});

type ProjectSpecs = z.infer<typeof projectSpecsSchema>;

const fetchOfferFileTool = tool({
    description: "Fetches the latest offer file from the database based on the provided lead ID.",
    inputSchema: z.object({
        leadId: z.number().describe("The ID of the lead for which to fetch the offer file."),
    }),
    execute: async ({ leadId }) => {
        const offerFile = await prisma.offerFile.findFirst({
            where: {
                offer: {
                    leadId: leadId,
                }
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!offerFile) {
            throw new Error(`No offer file found for lead ID: ${leadId}`);
        }

        return offerFile.offerContent as unknown as OfferFile;
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
                history: true,
                noteAnnotations: true,
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
                fetchOfferFile: fetchOfferFileTool,
                fetchAdditionalLeadInfo: fetchAdditionalLeadInfoTool,
            },
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