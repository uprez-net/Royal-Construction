import { serviceItemSchema } from "@/utils/chat";
import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";

function stripUndefined<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
        Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
    ) as Partial<T>;
}

export const offerFileTool = (dataStream: UIMessageStreamWriter) =>
    tool({
        description: `
            Creates or updates customer-facing offer document sections.

            PATCHING RULES:
            - The tool accepts partial payloads.
            - Any field included in the payload replaces or updates the corresponding section of the offer.
            - Any field omitted from the payload must remain unchanged.
            - Send only changed fields unless intentionally replacing a section.

            LIST FIELD RULES:
            - For termsAndConditions and serviceExclusions, send the complete final list whenever that field is included.
            - For serviceInclusions, send complete final items for every section being created or modified.
            - Do not send only newly added items for these fields.

            SERVICE INCLUSION RULES:
            - serviceInclusions is organized into sections.
            - Each section is identified by its id.
            - When modifying an existing section, keep the same id.
            - When creating a new section, generate a new unique id.
            - Each section's items array must contain the complete final set of line items for that section.

            USAGE:
            - Initial offer creation: provide all known sections.
            - Incremental update: provide only the sections being changed.
            - Append operation: merge new information with existing information and send the final desired state for any modified list field.

            The tool returns only customer-facing offer data and should be treated as the source of truth for subsequent updates.
            `,
        inputSchema: z.object({
            changeDescription: z
                .string()
                .optional()
                .describe(
                    "Human-readable summary of the modification being made, such as 'Initial offer creation', 'Added bathroom inclusions', 'Updated payment schedule', or 'Removed electrical exclusions'."
                ),

            leadId: z
                .number()
                .optional()
                .describe(
                    "Lead identifier associated with this offer. Typically provided during offer creation and rarely changed afterwards."
                ),

            projectDescription: z
                .string()
                .optional()
                .describe(
                    "Customer-facing description of the project scope, objectives, deliverables, or proposed works."
                ),

            paymentTerms: z
                .string()
                .optional()
                .describe(
                    "Customer-facing payment schedule and payment conditions, including milestone payments, deposits, progress claims, and final payment requirements."
                ),

            termsAndConditions: z
                .array(z.string())
                .optional()
                .describe(
                    "Complete final list of terms and conditions. Each array element represents a separate clause. When updating, provide the entire merged list that should exist after the update, not only newly added clauses."
                ),

            serviceInclusions: z
                .array(serviceItemSchema)
                .optional()
                .describe(
                    "Complete set of service inclusion sections being created or modified. Each section must contain a stable id, a section title, and the full final list of items for that section. Keep ids unchanged when updating existing sections."
                ),

            serviceExclusions: z
                .array(z.string())
                .optional()
                .describe(
                    "Complete final list of service exclusions. Each item should describe work, materials, approvals, permits, reports, or services that are not included in the offer. When updating, provide the entire merged list."
                ),

            serviceExclusionsFootnote: z
                .string()
                .optional()
                .describe(
                    "Optional customer-facing note displayed beneath the service exclusions section. Typically used for clarifications, assistance offers, assumptions, supplier references, or special exclusion-related remarks."
                ),
        }),
        execute: async (params) => {
            const customerOffer = stripUndefined({
                leadId: params.leadId,
                projectDescription: params.projectDescription,
                termsAndConditions: params.termsAndConditions,
                paymentTerms: params.paymentTerms,
                serviceInclusions: params.serviceInclusions,
                serviceExclusions: params.serviceExclusions,
                serviceExclusionsFootnote: params.serviceExclusionsFootnote,
            });

            dataStream.write({
                type: "data-offer-file-update",
                data: customerOffer,
            });

            return {
                message: `Offer file generated for lead ${params.leadId ?? "unknown"}`,
                description: params.changeDescription,
                customerOffer,
            };
        },
    });