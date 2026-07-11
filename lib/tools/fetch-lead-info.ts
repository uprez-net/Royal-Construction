import { tool } from "ai";
import z from "zod";
import { findLeadById } from "../data/leads";
import { getFilesByLeadId } from "../data/file";

function compactValue(value: unknown) {
    return value === null || value === undefined || value === "" ? undefined : value;
}

function summarizeLeadForOffer(lead: Awaited<ReturnType<typeof findLeadById>>) {
    if (!lead) return null;

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
        recentHistory: (lead.history ?? []).slice(-5).map((item) => ({
            date: compactValue(item.date),
            action: compactValue(item.action),
            detail: compactValue(item.detail),
            type: compactValue(item.type),
        })),
    };
}

function summarizeLeadFile(file: Awaited<ReturnType<typeof getFilesByLeadId>>["files"][number]) {
    return {
        id: file.id,
        filename: file.filename,
        fileType: file.fileType,
        filesize: file.filesize,
        url: file.url,
        createdAt: file.createdAt.toISOString(),
    };
}

export const fetchLeadInfoTool = tool({
    description: "Fetches concise CRM lead context for offer creation, review, or refinement. Use this before asking the user for lead details that may already exist in the CRM.",
    inputSchema: z.object({
        leadId: z.number().describe("Unique identifier for the lead to fetch information for"),
    }),
    execute: async (params) => {
        const leadInfo = await findLeadById(params.leadId);

        return {
            success: leadInfo !== null,
            message: leadInfo ? "Lead context retrieved and summarized for offer work." : "Lead not found.",
            data: summarizeLeadForOffer(leadInfo),
            fullContext: leadInfo, // Include the full lead context for reference, even if not summarized
        };
    }
});

export const fetchLeadFilesTool = tool({
    description: "Fetches concise metadata for files attached to a lead. Use this to decide which documents should be processed for offer scope, quantities, pricing, or exclusions.",
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
                files: files.files.map(summarizeLeadFile),
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
