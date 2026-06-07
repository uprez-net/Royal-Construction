import { ChatMessageAI, ChatTools, KnownToolName, ToolPart, ToolPartWithOutput, ToolPartWithState, ToolState, ToolType } from "@/types/chat";
import type { ChatMessage } from "@prisma/client";
import { formatISO } from "date-fns";
import { UIMessagePart, UIDataTypes } from "ai";
import { LineItem, OfferFile } from "@/context/ChatContext";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

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
  const lineItems: LineItem[] = [];
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

export function extractOfferFileFromMessage(message: ChatMessageAI[]): OfferFile {
  let offerFile: OfferFile = {
    termsAndConditions: [],
    projectDescription: "",
    paymentTerms: "",
    serviceInclusions: [],
    serviceExclusions: [],
  };
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
        const updatedServiceInclusions = mergeServiceItems(
          offerFile.serviceInclusions,
          customerOffer.serviceInclusions
        );

        const updatedServiceExclusions = mergeServiceItems(
          offerFile.serviceExclusions,
          customerOffer.serviceExclusions
        );
        // Patch and update the offerFile object with the output data
        offerFile = {
          ...offerFile,
          ...customerOffer,
          termsAndConditions: [
            ...(offerFile.termsAndConditions ?? []),
            ...(customerOffer.termsAndConditions ?? []),
          ].flat(),
          serviceInclusions: updatedServiceInclusions,
          serviceExclusions: updatedServiceExclusions,
        };
      }
    }
  }
  return offerFile;
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

export const serviceItemSchema = z.object({
  id: z.string().describe("Unique identifier for the service item"),
  sectionTitle: z.string().describe("Optional title for the section of service items like 'Kitchen' or 'Bathroom'. Can be left out if not applicable."),
  items: z.array(z.string()).describe("List of services included or excluded in the offer. Each item should be a concise description of the service."),
});

export type ServiceItem = z.infer<typeof serviceItemSchema>;


export function mergeServiceItems(
  existing: ServiceItem[] = [],
  incoming: ServiceItem[] = []
): ServiceItem[] {
  const map = new Map<string, ServiceItem>();

  for (const item of existing) {
    map.set(item.id, item);
  }

  for (const item of incoming) {
    const current = map.get(item.id);

    map.set(
      item.id,
      current
        ? {
          ...current,
          ...item,
          items: [...new Set([...current.items, ...item.items])],
        }
        : item
    );
  }

  return [...map.values()];
}
