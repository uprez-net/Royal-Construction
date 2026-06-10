import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";
import { FacadeOptionWithImageUrl, offerFileContentSchema } from "../agent/offer-prompts";
import { imageGenerationAgent } from "../agent/imageGenerationAgent";
import type { OfferFile } from "@/context/ChatContext";

function stripUndefined<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
        Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
    ) as Partial<T>;
}

const offerFileContentAppendSchema = offerFileContentSchema.extend({
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


    revisionChanges: z
        .object({
            description: z.string().describe("Description of the changes made in this revision, such as 'Added bathroom inclusions', 'Updated payment schedule', or 'Removed electrical exclusions'."),
            valueAdded: z.number().describe("Estimated dollar value added to the offer as a result of this change. For initial offer creation, this should be the total contract amount."),
            youSave: z.number().describe("Estimated dollar amount the client saves as a result of this change compared to a traditional cost-plus contract. For initial offer creation, this should be the estimated savings compared to a typical cost-plus pricing for the same scope."),
        })
        .optional()
        .describe(
            "Summary of the changes made in this revision, the estimated value added to the offer as a result of these changes, and the estimated savings for the client compared to a traditional cost-plus contract. For initial offer creation, this should summarize the overall value proposition of the offer, the total estimated contract amount, and the total estimated savings compared to typical cost-plus pricing."
        ),
})

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
        inputSchema: offerFileContentAppendSchema,
        execute: async (params) => {
            const customerOffer = stripUndefined({
                leadId: params.leadId,
                projectWelcomeMessage: params.projectWelcomeMessage,
                termsAndConditions: params.termsAndConditions,
                projectScope: params.projectScope,
                fixedPriceItems: params.fixedPriceItems,
                promotionalUpgrades: params.promotionalUpgrades,
                revisionChanges: params.revisionChanges,
                facadeOptions: params.facadeOptions,
            });

            const Options: FacadeOptionWithImageUrl["options"] = [];
            if (customerOffer.facadeOptions) {
                for (const option of customerOffer.facadeOptions.options) {
                    const image = await imageGenerationAgent.generate({
                        prompt: `
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

            dataStream.write({
                type: "data-offer-file-update",
                data: {
                    ...customerOffer,
                    facadeOptions: customerOffer.facadeOptions ? {
                        optionsDescription: customerOffer.facadeOptions.optionsDescription,
                        options: Options,
                    } : undefined,
                } satisfies OfferFile,
            });

            return {
                message: `Offer file generated for lead ${params.leadId ?? "unknown"}`,
                description: params.changeDescription,
                customerOffer: {
                    ...customerOffer,
                    facadeOptions: customerOffer.facadeOptions ? {
                        optionsDescription: customerOffer.facadeOptions.optionsDescription,
                        options: Options,
                    } : undefined,
                } satisfies OfferFile,
            };
        },
    });