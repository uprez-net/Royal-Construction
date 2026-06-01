import { tool } from "ai";
import z from "zod";
import { findLeadById } from "../data/leads";

export const fetchLeadInfoTool = tool({
    description: "Fetches lead information based on a provided lead ID",
    inputSchema: z.object({
        leadId: z.number().describe("Unique identifier for the lead to fetch information for"),
    }),
    execute: async (params) => {
        const leadInfo = await findLeadById(params.leadId);

        return {
            success: leadInfo !== null,
            message: leadInfo ? "Lead information retrieved successfully." : "Lead not found.",
            data: leadInfo,
        };
    }
});