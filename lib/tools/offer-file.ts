import { ChatMessageAI } from "@/types/chat";
import { tool, UIMessageStreamWriter } from "ai";
import z from "zod";

export const offerFileTool = (dataStream: UIMessageStreamWriter<ChatMessageAI>) => tool({
    description: "Handles generation and update of sections of offer file in the UI",
    inputSchema: z.object({
        termsAndConditions: z.string().describe("Terms and conditions for the offer"),
        projectDescription: z.string().describe("Description of the project for which the offer is being created"),
        paymentTerms: z.string().describe("Payment terms for the offer"),
        serviceInclusions: z.array(z.string()).describe("List of services included in the offer"),
        serviceExclusions: z.array(z.string()).describe("List of services excluded from the offer"),
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
    }
})