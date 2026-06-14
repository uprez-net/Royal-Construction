import z from "zod";
import { tool } from "ai";
import { processPDFWithMistral } from "@/lib/ocr";
import { summarizeOcrPagesForOffer } from "./offer-context";

export const FileProcessingTool = tool({
    description: `Processes an uploaded lead PDF for offer work. Use this only when a file is relevant to scope, quantities, plans, prior quotes, material schedules, inclusions, exclusions, or pricing evidence. The tool returns a concise offer-focused summary, not raw OCR pages.`,
    inputSchema: z.object({
        fileUrl: z.url().describe("URL of the uploaded lead PDF to process."),
        fileName: z.string().optional().describe("Optional filename for source attribution."),
    }),
    execute: async ({ fileUrl, fileName }) => {
        try {
            const pages = await processPDFWithMistral(fileUrl);
            const summary = summarizeOcrPagesForOffer(pages, { fileUrl, fileName });

            return {
                success: true,
                message: "File processed into an offer-focused summary.",
                data: summary,
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to process file: ${error instanceof Error ? error.message : String(error)}`,
                data: null,
            };
        }
    }
});