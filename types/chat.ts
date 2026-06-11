import { fetchLeadInfoTool as createFetchLeadInfoTool, fetchLeadFilesTool } from "@/lib/tools/fetch-lead-info";
import { fetchOfferSheetRules } from "@/lib/tools/fetch-offer-sheet-rules";
import { FileProcessingTool } from "@/lib/tools/file-tools";
import { lineItemTool as createLineItemTool } from "@/lib/tools/line-item";
import { offerFileTool as createOfferFileTool } from "@/lib/tools/offer-file";
import { webSearch } from "@/lib/tools/web-search";
import { ChatMessage, ChatSession } from "@prisma/client";
import type {
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  StepStartUIPart,
  ToolUIPart,
  InferUITool,
  UIDataTypes,
  UIMessage
} from "ai";
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
  fetchOfferSheetRulesTool: InferUITool<typeof fetchOfferSheetRules>;
  webSearch: InferUITool<typeof webSearch>;
}

export type OfferFileToolOutput = offerFileToolUI["output"];
export type LineItemToolOutput = lineItemToolUI["output"];
export type FetchLeadInfoToolOutput = InferUITool<typeof createFetchLeadInfoTool>["output"];
export type FetchLeadFilesToolOutput = InferUITool<typeof fetchLeadFilesTool>["output"];
export type FileProcessingToolOutput = InferUITool<typeof FileProcessingTool>["output"];
export type FetchOfferSheetRulesToolOutput = InferUITool<typeof fetchOfferSheetRules>["output"];
export type WebSearchToolOutput = InferUITool<typeof webSearch>["output"];

export type ChatMessageAI = UIMessage<
  MessageMetadata,
  UIDataTypes,
  ChatTools
>;

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

// UI Types
/**
 * This union represents “UI parts” you might render in your stream.
 * We only handle tool-* parts here, but keep union for your upstream list typing.
 */
export type ToolType =
  | ReasoningUIPart
  | DynamicToolUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | FileUIPart
  | StepStartUIPart
  | { type: `data-${string}`; id?: string; data: unknown }
  | ToolUIPart<ChatTools>;

/**
 * A strongly-typed view of ONLY tool parts.
 */
export type ToolPart = Extract<ToolType, { type: `tool-${string}` }>;

/**
 * Tool execution state we care about.
 * (We avoid `as any` by narrowing with type guards below.)
 */
export type ToolState =
  | "pending"
  | "partial-call"
  | "call"
  | "output-available"
  | "output-error";

/**
 * A typed refinement of ToolPart that includes state/output when present.
 * We don't assume the AI SDK always includes them, so we guard at runtime.
 */
export type ToolPartWithState = ToolPart & { state: ToolState };
export type ToolPartWithOutput = ToolPartWithState & {
  state: "output-available";
  output: unknown;
};

/**
 * Known tool names (tightens switch statements).
 * If you add more named tools later, extend this union.
 */
export type KnownToolName =
  | "lineItemTool"
  | "offerFileTool"
  | "fetchLeadInfoTool"
  | "fetchLeadFilesTool" 
  | "fileProcessingTool"
  | "fetchOfferSheetRulesTool"
  | "webSearch"
  ;