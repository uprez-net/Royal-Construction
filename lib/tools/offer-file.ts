import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";

export const offerFileTool = (dataStream: UIMessageStreamWriter) => tool({
    description: "Handles generation and update of sections of offer file in the UI",
    inputSchema: z.object({
        termsAndConditions: z.string().describe("Terms and conditions for the offer").optional(),
        projectDescription: z.string().describe("Description of the project for which the offer is being created").optional(),
        paymentTerms: z.string().describe("Payment terms for the offer").optional(),
        serviceInclusions: z.array(z.string()).describe("List of services included in the offer").optional(),
        serviceExclusions: z.array(z.string()).describe("List of services excluded from the offer").optional(),
    }),
    execute: async (params) => {
        // Send the offer file data back to the UI via the data stream
        dataStream.write({
            type: "data-offer-file-update",
            data: {
                termsAndConditions: params.termsAndConditions,
                projectDescription: params.projectDescription,
                paymentTerms: params.paymentTerms,
                serviceInclusions: params.serviceInclusions,
                serviceExclusions: params.serviceExclusions,
            },
        });

        return {
            message: `Offer file data processed successfully.`,
            description: `Updated offer file sections: ${Object.keys(params).filter(key => params[key as keyof typeof params] !== undefined).join(", ")}.`,
            ...params,
        }
    }
})