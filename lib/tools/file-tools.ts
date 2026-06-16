import z from "zod";
import { tool } from "ai";
import { processPDFWithMistral } from "@/lib/ocr";
import { summarizeOcrPagesForOffer } from "./offer-context";
import type { ChatMessageAI } from "@/types/chat";
import type { FileUIPart } from "ai";

const extractMediaTypeFromBase64 = (base64String: string): string => {
    const match = base64String.match(/^data:(image\/[a-zA-Z]+);base64,/);
    return match ? match[1] : 'image/jpeg'; // Default to 'image/jpeg' if media type is not found
}

const mediaTypeToExtension = (mediaType: string): string => {
    const mapping: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
        'image/tiff': 'tiff',
        // Add more mappings as needed
    };

    return mapping[mediaType] || 'bin'; // Default to 'bin' if media type is not recognized
}

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
            const images = pages
                .flatMap(page => page.images ?? [])
                .filter(
                    (image): image is typeof image & { imageBase64: string } =>
                        typeof image.imageBase64 === "string" &&
                        image.imageBase64.trim().length > 0
                );
            const fileInput: ChatMessageAI[] = images.length > 0 ?
                images.map(image => {
                    const file: ChatMessageAI = {
                        id: `file-${image.id}`,
                        role: "system",
                        parts: [
                            {
                                type: "file",
                                mediaType: extractMediaTypeFromBase64(image.imageBase64),
                                filename: `file-${image.id}.${mediaTypeToExtension(extractMediaTypeFromBase64(image.imageBase64))}`,
                                url: image.imageBase64,
                            } as FileUIPart
                        ]

                    }
                    return file;
                }) : [];

            return {
                success: true,
                message: "File processed into an offer-focused summary.",
                data: {
                    summary,
                    images: fileInput,
                },
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