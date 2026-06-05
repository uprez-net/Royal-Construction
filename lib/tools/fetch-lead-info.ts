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
        // Always return a consistent structured response. If no files found, return success: false with empty array.
        if (files && files.success && files.count > 0) {
            return {
                success: true,
                message: `${files.count} file(s) retrieved successfully for the lead.`,
                files: files.files,
                count: files.count,
            };
        }

        return {
            success: false,
            message: `No files found for lead ${params.leadId}.`,
            files: [],
            count: 0,
        };
    }
});

