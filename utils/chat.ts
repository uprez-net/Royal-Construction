import { ChatMessageAI, ChatTools, KnownToolName, ToolPart, ToolPartWithOutput, ToolPartWithState, ToolState, ToolType } from "@/types/chat";
import type { ChatMessage } from "@prisma/client";
import { formatISO } from "date-fns";
import { UIMessagePart, UIDataTypes } from "ai";
import type { LineItem, OfferFile } from "@/context/ChatContext";
import { v4 as uuidv4 } from "uuid";
import z from "zod";

type TermsAndConditionsItem = NonNullable<OfferFile["termsAndConditions"]>[number];

export interface StringListPatch {
  add?: string[];
  remove?: string[];
  reorder?: string[];
  replace?: string[];
  clear?: boolean;
}

export interface TermsAndConditionsPatch {
  add?: TermsAndConditionsItem[];
  update?: TermsAndConditionsItem[];
  removeTitles?: string[];
  reorderTitles?: string[];
  replace?: TermsAndConditionsItem[];
  clear?: boolean;
}

export interface ProjectScopePatch {
  add?: ServiceItem[];
  update?: ServiceItem[];
  removeIds?: string[];
  reorderIds?: string[];
  replace?: ServiceItem[];
  clear?: boolean;
}

export type OfferFilePatchPayload = Partial<OfferFile> & {
  termsAndConditionsPatch?: TermsAndConditionsPatch;
  projectScopePatch?: ProjectScopePatch;
  fixedPriceItemsPatch?: StringListPatch;
  promotionalUpgradesPatch?: StringListPatch;
};

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
    name === "fetchLeadFilesTool" ||
    name === "fileProcessingTool" ||
    name === "fetchOfferSheetRulesTool" ||
    name === "webSearch" ||
    name === "scrapeUserLinks"
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
          gstRate: lineItemOutput.gstRate ?? 0.10,
          gstIncluded: lineItemOutput.gstIncluded,
          netLine: lineItemOutput.netLine,
          gstAmount: lineItemOutput.gstAmount
        });
      }
    }
  }
  return lineItems;
}

export function extractOfferFileFromMessage(message: ChatMessageAI[], lastFile: OfferFile): OfferFile {
  let offerFile: OfferFile = lastFile;
  
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
        offerFile = applyOfferFileUpdate(
          offerFile,
          customerOffer as OfferFilePatchPayload,
        );
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
  id: z
    .uuid()
    .describe(
      "Stable unique identifier for this service section. Must remain unchanged when updating an existing section. Generate a new id only when creating a brand-new section."
    ),

  sectionTitle: z
    .string()
    .describe(
      "Customer-facing title for the service section (e.g. 'Kitchen', 'Bathroom', 'Electrical Works', 'Painting'). Groups related service items together. Required for each section."
    ),

  items: z
    .array(z.string())
    .describe(
      "Complete list of service line items belonging to this section. Each entry should be a short, customer-facing statement describing a single inclusion or exclusion. When updating a section, provide the full final list of items that should exist after the update."
    ),
});

export type ServiceItem = z.infer<typeof serviceItemSchema>;


export function mergeServiceItems(
  existing: ServiceItem[] = [],
  incoming: ServiceItem[] = []
): ServiceItem[] {
  const merged = [...existing];

  for (const incomingItem of incoming) {
    const index = merged.findIndex((item) => item.id === incomingItem.id);
    if (index === -1) {
      merged.push(incomingItem);
      continue;
    }

    merged[index] = {
      ...merged[index],
      ...incomingItem,
      // Incoming section items represent the desired final state for that section.
      items: [...incomingItem.items],
    };
  }

  return merged;
}

function normalizeString(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const key = normalizeString(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }

  return output;
}

function applyStringListPatch(
  current: string[] = [],
  patch?: StringListPatch,
  directReplacement?: string[],
): string[] {
  let result = directReplacement ? uniqueStrings([...directReplacement]) : uniqueStrings([...current]);

  if (!patch) return result;

  if (patch.clear) {
    result = [];
  }

  if (patch.replace) {
    result = uniqueStrings([...patch.replace]);
  }

  if (patch.remove?.length) {
    const removeSet = new Set(patch.remove.map(normalizeString));
    result = result.filter((item) => !removeSet.has(normalizeString(item)));
  }

  if (patch.add?.length) {
    result = uniqueStrings([...result, ...patch.add]);
  }

  if (patch.reorder?.length) {
    const order = patch.reorder.map(normalizeString);
    const position = new Map(order.map((key, index) => [key, index]));
    result = [...result].sort((a, b) => {
      const indexA = position.get(normalizeString(a));
      const indexB = position.get(normalizeString(b));
      const safeA = indexA ?? Number.MAX_SAFE_INTEGER;
      const safeB = indexB ?? Number.MAX_SAFE_INTEGER;
      return safeA - safeB;
    });
  }

  return result;
}

function uniqueTerms(items: TermsAndConditionsItem[]): TermsAndConditionsItem[] {
  const map = new Map<string, TermsAndConditionsItem>();
  for (const item of items) {
    map.set(normalizeString(item.title), item);
  }
  return [...map.values()];
}

function applyTermsPatch(
  current: TermsAndConditionsItem[] = [],
  patch?: TermsAndConditionsPatch,
  directReplacement?: TermsAndConditionsItem[],
): TermsAndConditionsItem[] {
  let result = directReplacement ? uniqueTerms([...directReplacement]) : uniqueTerms([...current]);

  if (!patch) return result;

  if (patch.clear) {
    result = [];
  }

  if (patch.replace) {
    result = uniqueTerms([...patch.replace]);
  }

  if (patch.removeTitles?.length) {
    const removeSet = new Set(patch.removeTitles.map(normalizeString));
    result = result.filter((item) => !removeSet.has(normalizeString(item.title)));
  }

  if (patch.update?.length) {
    const map = new Map(result.map((item) => [normalizeString(item.title), item]));
    for (const item of patch.update) {
      map.set(normalizeString(item.title), item);
    }
    result = [...map.values()];
  }

  if (patch.add?.length) {
    result = uniqueTerms([...result, ...patch.add]);
  }

  if (patch.reorderTitles?.length) {
    const order = patch.reorderTitles.map(normalizeString);
    const position = new Map(order.map((key, index) => [key, index]));
    result = [...result].sort((a, b) => {
      const indexA = position.get(normalizeString(a.title));
      const indexB = position.get(normalizeString(b.title));
      const safeA = indexA ?? Number.MAX_SAFE_INTEGER;
      const safeB = indexB ?? Number.MAX_SAFE_INTEGER;
      return safeA - safeB;
    });
  }

  return result;
}

function applyProjectScopePatch(
  current: ServiceItem[] = [],
  patch?: ProjectScopePatch,
  directReplacement?: ServiceItem[],
): ServiceItem[] {
  let result = directReplacement ? [...directReplacement] : [...current];

  if (!patch) return result;

  if (patch.clear) {
    result = [];
  }

  if (patch.replace) {
    result = [...patch.replace];
  }

  if (patch.removeIds?.length) {
    const removeSet = new Set(patch.removeIds);
    result = result.filter((item) => !removeSet.has(item.id));
  }

  if (patch.update?.length) {
    result = mergeServiceItems(result, patch.update);
  }

  if (patch.add?.length) {
    result = mergeServiceItems(result, patch.add);
  }

  if (patch.reorderIds?.length) {
    const position = new Map(
      patch.reorderIds.map((id, index) => [id, index]),
    );
    result = [...result].sort((a, b) => {
      const indexA = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const indexB = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return indexA - indexB;
    });
  }

  return result;
}

export function applyOfferFileUpdate(
  current: OfferFile,
  incoming: OfferFilePatchPayload,
): OfferFile {
  const updatedValue: OfferFile = {
    ...current,
    ...(incoming.projectWelcomeMessage !== undefined
      ? { projectWelcomeMessage: incoming.projectWelcomeMessage }
      : {}),
    ...(incoming.revisionChanges !== undefined
      ? { revisionChanges: incoming.revisionChanges }
      : {}),
    ...(incoming.facadeOptions !== undefined
      ? { facadeOptions: incoming.facadeOptions }
      : {}),
    termsAndConditions: applyTermsPatch(
      current.termsAndConditions ?? [],
      incoming.termsAndConditionsPatch,
      incoming.termsAndConditions,
    ),
    projectScope: applyProjectScopePatch(
      current.projectScope ?? [],
      incoming.projectScopePatch,
      incoming.projectScope,
    ),
    fixedPriceItems: applyStringListPatch(
      current.fixedPriceItems ?? [],
      incoming.fixedPriceItemsPatch,
      incoming.fixedPriceItems,
    ),
    promotionalUpgrades: applyStringListPatch(
      current.promotionalUpgrades ?? [],
      incoming.promotionalUpgradesPatch,
      incoming.promotionalUpgrades,
    ),
  };
  return updatedValue;
}

export const isOfferFileInComplete = (offerFile: OfferFile): boolean => {
  return (
    (offerFile.termsAndConditions?.length ?? 0) > 0 ||
    (offerFile.projectScope?.length ?? 0) > 0 ||
    (offerFile.fixedPriceItems?.length ?? 0) > 0 ||
    (offerFile.promotionalUpgrades?.length ?? 0) > 0 ||
    (offerFile.projectWelcomeMessage?.length ?? 0) > 0 ||
    (offerFile.revisionChanges?.description?.length ?? 0) > 0 ||
    (offerFile.revisionChanges?.valueAdded ?? 0) > 0 ||
    (offerFile.revisionChanges?.youSave ?? 0) > 0
  );
}