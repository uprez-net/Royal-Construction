import { serviceItemSchema } from "@/utils/chat";
import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";

export const offerFileTool = (dataStream: UIMessageStreamWriter) =>
    tool({
        description:
            `
            Generates or patches an offer file based on the provided information.
            Use this tool to CREATE, PATCH, or APPEND offer data by sending only the fields that changed.
            Any provided field should be treated as an update for that section, while omitted fields should remain unchanged.
            For list fields (termsAndConditions, serviceInclusions, serviceExclusions), send the full merged list you want saved after patching/appending.
            The tool accepts partial payloads for incremental updates and returns the customer-facing offer data through this tool response/stream.
            `,
        inputSchema: z.object({
            changeDescription: z.string().optional().describe("Description of the change being made to the offer file, e.g. 'Initial creation', 'Added payment terms', etc."),
            leadId: z.number().optional().describe("Optional lead id to associate the offer with"),
            projectDescription: z.string().optional().describe("Description of the project"),
            paymentTerms: z.string().optional().describe("Payment terms for the offer"),
            termsAndConditions: z.array(z.string()).optional().describe("Terms and conditions for the offer, each item in the array represents a separate term or condition. For patching/appending, send the full merged list of terms and conditions you want saved or updated."),
            serviceInclusions: z.array(serviceItemSchema).optional().describe("List of services included in the offer, keep the ids consistent for patching"),
            serviceExclusions: z.array(serviceItemSchema).optional().describe("List of services excluded from the offer, keep the ids consistent for patching"),
        }),
        execute: async (params) => {

            // Write only customer-facing data to the UI stream
            dataStream.write({
                type: "data-offer-file-update",
                data: {
                    leadId: params.leadId,
                    projectDescription: params.projectDescription,
                    termsAndConditions: params.termsAndConditions,
                    paymentTerms: params.paymentTerms,
                    serviceInclusions: params.serviceInclusions,
                    serviceExclusions: params.serviceExclusions,
                },
            });

            return {
                message: `Offer file generated for lead ${params.leadId ?? "unknown"}`,
                description: params.changeDescription,
                customerOffer: {
                    leadId: params.leadId,
                    projectDescription: params.projectDescription,
                    termsAndConditions: params.termsAndConditions,
                    paymentTerms: params.paymentTerms,
                    serviceInclusions: params.serviceInclusions,
                    serviceExclusions: params.serviceExclusions,
                },
            };
        },
    });