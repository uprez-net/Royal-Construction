import z from "zod";
import { tool } from "ai";
import { processPDFWithMistral } from "@/lib/ocr";

export const FileProcessingTool = tool({
    description: "An agent that processes files by downloading them and extracting key information.",
    inputSchema: z.object({
        fileUrl: z.url().describe("The URL of the file to process"),
    }),
    execute: async ({ fileUrl }) => {
        try {
            const result = await processPDFWithMistral(fileUrl);
            return {
                success: true,
                message: "File processed successfully",
                data: result,
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