import { ChatMessageAI, ChatTools, KnownToolName, ToolPart, ToolPartWithOutput, ToolPartWithState, ToolState, ToolType } from "@/types/chat";
import type { ChatMessage } from "@prisma/client";
import { formatISO } from "date-fns";
import { UIMessagePart, UIDataTypes } from "ai";
import { LineItem, OfferFile } from "@/context/ChatContext";
import { v4 as uuidv4 } from "uuid";

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

export function extractLineItemsFromMessage(message: ChatMessageAI[]): LineItem[] {
  let lineItems: LineItem[] = [];
  for (const msg of message) {
    for (const part of msg.parts) {
      // Look for parts that are tool outputs with type "lineItemTool"
      if (
        part.type === "tool-lineItemTool" &&
        hasToolState(part) &&
        part.state === "output-available" &&
        hasToolOutput(part)
      ) {
        // Validate that the output is an array of LineItems
        const lineItemOutput = part.output.data;
        lineItems.push({
          id: lineItemOutput.id,
          description: lineItemOutput.description,
          item: lineItemOutput.item,
          unitPrice: lineItemOutput.unitPrice,
          quantity: lineItemOutput.quantity,
          unit: lineItemOutput.unit,
          totalPrice: lineItemOutput.totalPrice,
          gstRate: lineItemOutput.gstRate ?? 18,
          gstIncluded: lineItemOutput.gstIncluded,
          netLine: lineItemOutput.netLine,
          gstAmount: lineItemOutput.gstAmount
        });
      }
    }
  }
  return lineItems;
}

export function extractOfferFileFromMessage(message: ChatMessageAI[]): OfferFile | undefined {
  for (const msg of message) {
    for (const part of msg.parts) {
      // Look for parts that are tool outputs with type "offerFileTool"
      if (
        part.type === "tool-offerFileTool" &&
        hasToolState(part) &&
        part.state === "output-available" &&
        hasToolOutput(part)
      ) {
        const { customerOffer } = part.output;
        return {
          termsAndConditions: customerOffer.termsAndConditions,
          projectDescription: customerOffer.projectDescription,
          paymentTerms: customerOffer.paymentTerms,
          serviceInclusions: customerOffer.serviceInclusions,
          serviceExclusions: customerOffer.serviceExclusions,
        };
      }
    }
  }
  return undefined;
}


const STARTING_AGENT_MESSAGE = `
Hello! I'm your offer assistant, here to help you create a personalized offer for your lead. 
To get started, please provide me with some basic information about the lead and their needs. You can also upload any relevant files or documents that might help me understand the context better. Once I have the necessary information, 
I'll be able to assist you in crafting an offer that meets your lead's requirements. 
Let's work together to create a compelling offer!
`
export function setInitialAgentMessage(msg: ChatMessageAI[]): ChatMessageAI[] {
  return msg.length > 0
    ? msg : [
      {
        id: uuidv4(),
        role: "assistant",
        parts: [{ type: "text", text: STARTING_AGENT_MESSAGE }],
        metadata: { createdAt: new Date().toISOString() },
      },
    ]
}