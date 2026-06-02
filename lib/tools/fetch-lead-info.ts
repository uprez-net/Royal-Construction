import { tool } from "ai";
import z from "zod";
import { findLeadById } from "../data/leads";
import { getFilesByLeadId } from "../data/file";

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

export const fetchLeadFilesTool = tool({
    description: "Fetches files associated with a lead based on a provided lead ID",
    inputSchema: z.object({
        leadId: z.number().describe("Unique identifier for the lead to fetch associated files for"),
    }),
    execute: async (params) => {
        const files = await getFilesByLeadId(params.leadId);

        if(files.success && files.count > 0) {
            return {
                success: true,
                message: `${files.count} file(s) retrieved successfully for the lead.`,
                files: files.files,
            };
        }
    }
});

