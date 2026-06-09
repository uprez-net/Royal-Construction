import { ToolLoopAgent, Output } from "ai";
import { google } from "@ai-sdk/google";
import type { Lead as UiLead } from "@/lib/leads/types";
import type { File } from "@prisma/client";
import { fetchOfferSheetRules } from "../tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "../tools/file-tools";
import z from "zod";
import { serviceItemSchema } from "@/utils/chat";

// Need a prompt builder that takes in Lead Info and give the starter prompt to the agent to start the offer creation process. 
// The agent will then use the google search tool to find relevant information about the lead and then use that information to create an offer.
export function buildCreationStarterPrompt(lead: UiLead, leadFiles: File[]) {
    return `
    The lead information is as follows:
    Name: ${lead.name}
    Phone: ${lead.phone}
    Email: ${lead.email}
    Location: ${lead.location}
    Source: ${lead.source}
    Source Detail: ${lead.sourceDetail}
    Notes: ${lead.notes}
    Build Type: ${lead.type}
    Budget: ${lead.budget}
    Follow-up Date: ${lead.followupDate}
    Follow-up Time: ${lead.followupTime}
    Follow-up Notes: ${lead.followupNotes}

    The lead has the following files associated with it:
    ${leadFiles.length > 0 ? leadFiles.map(file => `- ${file.filename} (${file.url})`).join("\n") : "No files associated with this lead."}
    `;
}

const CREATION_SYSTEM_PROMPT = `
You are an assistant that helps create offers for leads. 
You will be given information about a lead and any files associated with that lead. 
Your task is to use this information to create an offer for the lead. 
You can use the google search tool to find relevant information about the lead and their needs.
Once you have gathered enough information, you will create an offer that is tailored to the lead's needs and budget. 
The offer should include a description of the services being offered, the price, and any other relevant details.
`;


export const offerCreationAgent = new ToolLoopAgent({
    model: google("gemini-3-flash-preview"),
    tools: {
        fetchOfferSheet: fetchOfferSheetRules,
        FileProcessingTool: FileProcessingTool,
    },
    instructions: CREATION_SYSTEM_PROMPT,
    output: Output.object({
        schema: z.object({
            lineItemArray: z.array(
                z.object({
                    id: z.uuid().describe("Unique identifier for the line item, used for updates"),
                    item: z.string().describe("Description of the line item"),
                    description: z.string().describe("Detailed description of the line item"),
                    unitPrice: z.number().describe("Unit price for the line item (numeric, as a decimal number)"),
                    quantity: z.number().describe("Quantity for the line item"),
                    unit: z.string().describe("Unit of measurement for the line item (e.g., 'each', 'lump sum', 'sqft', 'sqm')"),
                    gstRate: z.number().optional().describe("GST rate to apply to this line, expressed as a decimal (e.g., 0.10 for 10%). Optional; defaults to 0."),
                    gstIncluded: z.boolean().optional().describe("If true, the provided unitPrice includes GST already."),
                    source: z.string().optional().describe("Optional source filename or lead field where this cost originated"),
                })
            ).describe("Array of line items to include in the offer. Each item should have a unique id for tracking and updates."),
            offerFileContent: z.object({
                projectDescription: z
                    .string()
                    .describe(
                        "Customer-facing description of the project scope, objectives, deliverables, or proposed works."
                    ),

                paymentTerms: z
                    .string()
                    .describe(
                        "Customer-facing payment schedule and payment conditions, including milestone payments, deposits, progress claims, and final payment requirements."
                    ),

                termsAndConditions: z
                    .array(z.string())
                    .describe(
                        "Complete final list of terms and conditions. Each array element represents a separate clause. When updating, provide the entire merged list that should exist after the update, not only newly added clauses."
                    ),

                serviceInclusions: z
                    .array(serviceItemSchema)
                    .describe(
                        "Complete set of service inclusion sections being created or modified. Each section must contain a stable id, a section title, and the full final list of items for that section. Keep ids unchanged when updating existing sections."
                    ),

                serviceExclusions: z
                    .array(z.string())
                    .describe(
                        "Complete final list of service exclusions. Each item should describe work, materials, approvals, permits, reports, or services that are not included in the offer. When updating, provide the entire merged list."
                    ),

                serviceExclusionsFootnote: z
                    .string()
                    .describe(
                        "customer-facing note displayed beneath the service exclusions section. Typically used for clarifications, assistance offers, assumptions, supplier references, or special exclusion-related remarks."
                    ),
            }).describe("Structured content for the offer document, including descriptions, terms, inclusions, and exclusions. When updating an existing offer, provide only the sections that need to be created or modified, but ensure each section contains the complete final content for that section.")
        }),
    }),
})
