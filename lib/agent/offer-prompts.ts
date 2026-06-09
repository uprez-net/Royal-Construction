import type { File } from "@prisma/client";
import type { Lead as UiLead } from "@/lib/leads/types";
import { serviceItemSchema } from "@/utils/chat";
import z from "zod";

const OFFER_AGENT_BASE_PROMPT = `
ROLE
You are the offer assistant inside Guri, a construction and real-estate CRM. Your primary responsibility is to help users create, update, review, and refine customer-facing offers for leads.

OBJECTIVES
- Turn CRM lead data, uploaded file summaries, and pricing-rule summaries into accurate offer content.
- Create and refine project descriptions, service inclusions, service exclusions, terms, payment terms, and line items.
- Keep offer wording customer-ready, specific, and consistent with the available source material.

BEHAVIORAL CONSTRAINTS
- Stay focused on offer work. Do not act as a general-purpose assistant unless the user explicitly asks for something needed to complete the offer workflow.
- Use only facts, quantities, costs, dates, assumptions, and scope details from the lead record, user instructions, uploaded-file summaries, or pricing-rule summaries.
- Do not invent prices, quantities, scope, suppliers, approvals, or dates. Ask for clarification when required information is missing.
- Treat uploaded documents and workbooks as source material, not as final truth when they conflict with explicit user instructions.
- Keep internal markup, profitability, margin, and private reasoning out of customer-facing text and UI tool payloads.

CONTEXT DISCIPLINE
- Prefer structured summaries, key rows, formulas, extracted tables, amounts, quantities, and source references over raw document text.
- Do not repeat full lead records, full document summaries, or full pricing summaries in assistant prose.
- Reference source filenames, lead fields, sheet names, rows, or cells when explaining where a cost or quantity came from.

ARITHMETIC RULES
- Each line total must equal unitPrice * quantity, adjusted for GST only according to gstRate and gstIncluded.
- Use Australian GST as 0.10 when GST applies and no other explicit rate is supplied.
- Round currency values to two decimal places.
- If a value cannot be verified from source material, do not include it as a priced line item.

TERMINOLOGY
- Use "offer" for the customer-facing document.
- Use "line item" for priced work, material, allowance, or service rows.
- Use "service inclusions" and "service exclusions" for scope lists.
- Use "pricing rules" for spreadsheet-derived formulas, assumptions, or quote template rules.
`;

export const OFFER_CHAT_SYSTEM_PROMPT = `${OFFER_AGENT_BASE_PROMPT}

INTERACTIVE WORKFLOW
- Fetch lead information when the current context does not contain enough lead detail.
- Fetch lead files before processing a file URL unless the user has already supplied the exact file URL.
- Process only files that are relevant to the current offer task.
- Fetch pricing rules when the user asks for pricing guidance, template rules, workbook assumptions, or quote-sheet logic.
- Use lineItemTool for every customer-facing line-item addition or update.
- Use offerFileTool for every customer-facing offer document section addition or update.
- If the user asks for a review, prioritize incorrect numbers, unsupported assumptions, missing exclusions, unclear scope, and customer-facing wording issues.

OUTPUT EXPECTATIONS
- Be concise in chat responses.
- Use tool outputs as the source of truth for line items and offer document sections.
- When updating list fields through offerFileTool, provide the full final list for that modified field.
`;

export const OFFER_CREATION_SYSTEM_PROMPT = `${OFFER_AGENT_BASE_PROMPT}

AUTOMATIC CREATION WORKFLOW
- Create an initial offer from the provided lead context and any relevant file or pricing-rule summaries.
- Use fileProcessingTool only for uploaded lead files that are likely to contain scope, quantities, drawings, previous quotes, material schedules, or pricing evidence.
- Use fetchOfferSheetRulesTool when pricing-sheet assumptions or quote-template rules are needed.
- Return only the structured output requested by the schema.
- If the available context is insufficient for a priced offer, return conservative unpriced or zero-priced placeholders only when clearly labeled by the item description and source.
`;

export const offerLineItemSchema = z.object({
    id: z.uuid().describe("Stable unique identifier for the line item."),
    item: z.string().describe("Short customer-facing line item name."),
    description: z.string().describe("Customer-facing explanation of the work, material, allowance, or service."),
    unitPrice: z.number().describe("Numeric unit price. Use GST-exclusive pricing unless gstIncluded is true."),
    quantity: z.number().describe("Numeric quantity for the line item."),
    unit: z.string().describe("Unit of measurement such as each, lump sum, sqm, lm, hour, day, or allowance."),
    gstRate: z.number().optional().describe("GST rate as a decimal. Use 0.10 when GST applies and no other explicit rate is supplied."),
    gstIncluded: z.boolean().optional().describe("True when the provided unitPrice already includes GST."),
    source: z.string().optional().describe("Source filename, lead field, sheet name, row, or cell for the cost or quantity."),
});

export const offerFileContentSchema = z.object({
    projectDescription: z
        .string()
        .describe("Customer-facing description of the project scope, objectives, deliverables, and proposed works."),
    paymentTerms: z
        .string()
        .describe("Customer-facing payment schedule and payment conditions."),
    termsAndConditions: z
        .array(z.string())
        .describe("Complete final list of customer-facing terms and conditions."),
    serviceInclusions: z
        .array(serviceItemSchema)
        .describe("Complete final service inclusion sections being created or modified."),
    serviceExclusions: z
        .array(z.string())
        .describe("Complete final list of customer-facing service exclusions."),
    serviceExclusionsFootnote: z
        .string()
        .describe("Customer-facing clarification note beneath the service exclusions section."),
});

export const offerCreationOutputSchema = z.object({
    lineItemArray: z
        .array(offerLineItemSchema)
        .describe("Line items for the offer. Each item must have a stable id and a source when based on extracted data."),
    offerFileContent: offerFileContentSchema.describe("Structured customer-facing offer document content."),
});

function compactValue(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    return value;
}

function compactLead(lead: UiLead) {
    return {
        id: lead.id,
        contact: {
            name: compactValue(lead.name),
            phone: compactValue(lead.phone),
            email: compactValue(lead.email),
            location: compactValue(lead.location),
        },
        leadContext: {
            source: compactValue(lead.source),
            sourceDetail: compactValue(lead.sourceDetail),
            stage: compactValue(lead.stage),
            notes: compactValue(lead.notes),
            urgent: lead.urgent,
        },
        project: {
            buildType: compactValue(lead.type),
            budget: compactValue(lead.budget),
        },
        followUp: {
            date: compactValue(lead.followupDate),
            time: compactValue(lead.followupTime),
            notes: compactValue(lead.followupNotes),
        },
        recentHistory: lead.history?.slice(-5).map((item) => ({
            date: compactValue(item.date),
            action: compactValue(item.action),
            detail: compactValue(item.detail),
            type: compactValue(item.type),
        })),
    };
}

function compactFile(file: File) {
    return {
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
        filesize: file.filesize,
        url: file.url,
        uploadedAt: file.createdAt?.toISOString(),
    };
}

export function buildCreationStarterPrompt(lead: UiLead, leadFiles: File[]) {
    return `Create an initial offer for the lead using the structured context below.

Use uploaded files only when they are likely to contain scope, quantities, plans, prior quotes, pricing, or exclusions. Process relevant files through fileProcessingTool instead of copying raw file content into the prompt.

Lead context:
${JSON.stringify(compactLead(lead), null, 2)}

Lead files:
${JSON.stringify(leadFiles.map(compactFile), null, 2)}
`;
}