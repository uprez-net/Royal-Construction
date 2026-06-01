import { fetchLeadInfoTool as createFetchLeadInfoTool } from "@/lib/tools/fetch-lead-info";
import { lineItemTool as createLineItemTool } from "@/lib/tools/line-item";
import { offerFileTool as createOfferFileTool } from "@/lib/tools/offer-file";
import { ChatMessage, ChatSession } from "@prisma/client";
import { InferUITool, UIDataTypes, UIMessage } from "ai";
import z from "zod";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type lineItemToolUI = InferUITool<ReturnType<typeof createLineItemTool>>;
type offerFileToolUI = InferUITool<ReturnType<typeof createOfferFileTool>>;

export type ChatTools = {
    // Define your tools here, for example:
    lineItemTool: lineItemToolUI;
    offerFileTool: offerFileToolUI;
    fetchLeadInfoTool: InferUITool<typeof createFetchLeadInfoTool>;
}

export type ChatMessageAI = UIMessage<
  MessageMetadata,
  UIDataTypes,
  ChatTools
>;

export interface ChatSessionWithMessages extends ChatSession {
    messages: ChatMessage[];
}