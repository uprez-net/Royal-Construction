import { fetchLeadInfoTool as createFetchLeadInfoTool, fetchLeadFilesTool } from "@/lib/tools/fetch-lead-info";
import { FileProcessingTool } from "@/lib/tools/file-tools";
import { lineItemTool as createLineItemTool } from "@/lib/tools/line-item";
import { offerFileTool as createOfferFileTool } from "@/lib/tools/offer-file";
import { ChatMessage, ChatSession } from "@prisma/client";
import { InferUITool, UIDataTypes, UIMessage } from "ai";
import z from "zod";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// Inline the tool UI types to avoid circular type alias references
type lineItemToolUI = InferUITool<ReturnType<typeof createLineItemTool>>;
type offerFileToolUI = InferUITool<ReturnType<typeof createOfferFileTool>>;

export type ChatTools = {
  // Define your tools here, for example:
  lineItemTool: lineItemToolUI;
  offerFileTool: offerFileToolUI;
  fetchLeadInfoTool: InferUITool<typeof createFetchLeadInfoTool>;
  fileProcessingTool: InferUITool<typeof FileProcessingTool>;
  fetchLeadFilesTool: InferUITool<typeof fetchLeadFilesTool>;
}

export type OfferFileToolOutput = offerFileToolUI["output"];
export type LineItemToolOutput = lineItemToolUI["output"];
export type FetchLeadInfoToolOutput = InferUITool<typeof createFetchLeadInfoTool>["output"];
export type FetchLeadFilesToolOutput = InferUITool<typeof fetchLeadFilesTool>["output"];
export type FileProcessingToolOutput = InferUITool<typeof FileProcessingTool>["output"];

export type ChatMessageAI = UIMessage<
  MessageMetadata,
  UIDataTypes,
  ChatTools
>;

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export const STARTING_AGENT_MESSAGE = `
Hello! I'm your offer assistant, here to help you create a personalized offer for your lead. 
To get started, please provide me with some basic information about the lead and their needs. You can also upload any relevant files or documents that might help me understand the context better. Once I have the necessary information, 
I'll be able to assist you in crafting an offer that meets your lead's requirements. 
Let's work together to create a compelling offer!
`