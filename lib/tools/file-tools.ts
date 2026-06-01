import z from "zod";
import { tool, ToolLoopAgent, Output, stepCountIs } from "ai";
import { get } from "@vercel/blob";
import { streamToBase64 } from "@/utils/formatters";
import { google } from "@ai-sdk/google";

const downloadFileTool = tool({
    description: "Downloads a file from a given URL and returns it's parsed contents",
    inputSchema: z.object({
        fileUrl: z.url().describe("The URL of the file to download"),
    }),
    execute: async (params) => {
        try {
            const response = await get(params.fileUrl, {
                access: "public",
            });

            if (!response || response?.statusCode !== 200) {
                throw new Error(`Failed to fetch file. Status code: ${response?.statusCode}`);
            }
            const base64String = await streamToBase64(response.stream);
            return {
                success: true,
                message: "File downloaded and converted to base64 successfully",
                data: base64String,
                fileType: response.blob.contentType,
            };
        }
        catch (error) {
            console.error("Error downloading file", error);
            return {
                success: false,
                message: `Error downloading file: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }
});


const processingFileAgent = new ToolLoopAgent({
    model: google("gemini-3-flash-preview"),
    instructions: "You are a helpful assistant for processing files. You receive files in base64 format along with their type, and your task is to extract and summarize the key information from these files. Focus on providing concise summaries that capture the main points and relevant details from the content.",
    tools: {
        downloadFile: downloadFileTool,
    },
    toolChoice: "required",
    stopWhen: stepCountIs(3),
    output: Output.text(),
});

export const FileProcessingTool = tool({
    description: "An agent that processes files by downloading them and extracting key information.",
    inputSchema: z.object({
        fileUrl: z.url().describe("The URL of the file to process"),
    }),
    execute: async ({ fileUrl }) => {
        const result = await processingFileAgent.generate({ prompt: fileUrl });
        return {
            success: true,
            message: "File processed successfully",
            data: result.output,
        };
    }
});