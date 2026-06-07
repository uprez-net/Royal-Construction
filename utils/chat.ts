import { ChatMessageAI, ChatTools, KnownToolName, ToolPart, ToolPartWithOutput, ToolPartWithState, ToolState, ToolType } from "@/types/chat";
import type { ChatMessage } from "@prisma/client";
import { formatISO } from "date-fns";
import { UIMessagePart, UIDataTypes } from "ai";

export const convertToUIMessage = (message: ChatMessage[]): ChatMessageAI[] => {
    return message.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant" | "system",
        parts: msg.content as UIMessagePart<UIDataTypes, ChatTools>[],
        metadata: {
            createdAt: formatISO(msg.timestamp),
        },
    }));
}

export function isToolPart(part: ToolType): part is ToolPart {
  return part.type.startsWith("tool-");
}

export function isToolState(x: unknown): x is ToolState {
  return (
    x === "pending" ||
    x === "partial-call" ||
    x === "call" ||
    x === "output-available" ||
    x === "output-error"
  );
}

export function hasToolState(part: ToolPart): part is ToolPartWithState {
  return "state" in part && isToolState((part as { state?: unknown }).state);
}

export function hasToolOutput(part: ToolPartWithState): part is ToolPartWithOutput {
  return part.state === "output-available" && "output" in part;
}

export function isKnownToolName(name: string): name is KnownToolName {
  return (
    name === "lineItemTool" ||
    name === "offerFileTool" ||
    name === "fetchLeadInfoTool" ||
    name === "fileProcessingTool"
  );
}

export function toolNameFromType(type: ToolPart["type"]): string {
  return type.replace(/^tool-/, "");
}
