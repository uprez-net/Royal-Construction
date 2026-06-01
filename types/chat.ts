import { fetchLeadInfoTool } from "@/lib/tools/fetch-lead-info";
import { lineItemTool } from "@/lib/tools/line-item";
import { offerFileTool } from "@/lib/tools/offer-file";
import { ChatMessage, ChatSession } from "@prisma/client";
import { InferUITool, UIDataTypes, UIMessage } from "ai";
import z from "zod";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type lineItemTool = InferUITool<ReturnType<typeof lineItemTool>>;
type offerFileTool = InferUITool<ReturnType<typeof offerFileTool>>;

export type ChatTools = {
    // Define your tools here, for example:
    lineItemTool: lineItemTool;
    offerFileTool: offerFileTool;
    fetchLeadInfoTool: InferUITool<typeof fetchLeadInfoTool>;
}

export type ChatMessageAI = UIMessage<
  MessageMetadata,
  UIDataTypes,
  ChatTools
>;

export interface ChatSessionWithMessages extends ChatSession {
    messages: ChatMessage[];
}