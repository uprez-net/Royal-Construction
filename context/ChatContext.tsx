import { ChatMessageAI } from "@/types/chat";
import { ChatStatus, DefaultChatTransport } from "ai";
import { createContext, useContext, useMemo, useState } from "react";
import { useChat, UseChatHelpers } from "@ai-sdk/react";
import { fetchWithErrorHandlers } from "@/utils/chat-error";
import { v4 as generateUUID } from "uuid";
import { useAutoResume } from "@/hooks/use-auto-resume";
import {
  applyOfferFileUpdate,
  extractLineItemsFromMessage,
  extractOfferFileFromMessage,
  isOfferFileInComplete,
  OfferFilePatchPayload,
  ServiceItem,
} from "@/utils/chat";
import { SafeOfferDBFile, SafeOfferItem } from "@/types/offer";
import { max, min } from "date-fns";
import { dateFormat } from "@/utils/formatters";
import type {
  FacadeOptionWithImageUrl,
  TermsAndConditionsItem,
} from "@/lib/agent/offer-prompts";
import { hydratePricingFromStoredTotal } from "@/lib/offer/pricing";

interface ChatContextValue {
  lineItems: LineItem[];
  offerFile: OfferFile;
  lastRevisionDate?: string;
  proposalDate?: string;
  versions: number;
  currentVersion: number | "current";
  messages: ChatMessageAI[];
  status: ChatStatus;
  error?: Error;
  sendMessage: UseChatHelpers<ChatMessageAI>["sendMessage"];
  stop: UseChatHelpers<ChatMessageAI>["stop"];
  setMessages: UseChatHelpers<ChatMessageAI>["setMessages"];
  setVersion: (version: number | "current") => void;
  appendVersion: (
    version: number,
    lineItems: SafeOfferItem[],
    offerFile: SafeOfferDBFile,
  ) => void;
  setLineItems: (
    id: string,
    updates: Partial<Pick<LineItem, "unit" | "quantity" | "unitPrice">>,
  ) => void;
  addLineItem: (lineItem: LineItem) => void;
}

export interface LineItem {
  id: string;
  description: string;
  item: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  totalPrice: number;
  gstRate: number;
  gstIncluded: boolean;
  source?: string;
  netLine: number;
  gstAmount: number;
}

export interface OfferFile {
  termsAndConditions?: TermsAndConditionsItem[];
  facadeOptions?: FacadeOptionWithImageUrl;
  projectWelcomeMessage?: string;
  revisionChanges?: {
    description: string;
    valueAdded: number;
    youSave: number;
  };
  projectScope?: ServiceItem[];
  fixedPriceItems?: string[];
  promotionalUpgrades?: string[];
}

const emptyOfferFile: OfferFile = {
  termsAndConditions: [],
  projectWelcomeMessage: "",
  revisionChanges: {
    description: "",
    valueAdded: 0,
    youSave: 0,
  },
  projectScope: [],
  fixedPriceItems: [],
  promotionalUpgrades: [],
};

export const ChatContext = createContext<ChatContextValue | undefined>(
  undefined,
);

const getRevisionDate = (fileVersions: Record<number, SafeOfferDBFile>) => {
  const dates = Object.values(fileVersions).map(
    (file) => new Date(file.createdAt),
  );

  return dates.length ? dateFormat.format(max(dates)) : undefined;
};

const getProposalDate = (fileVersions: Record<number, SafeOfferDBFile>) => {
  const dates = Object.values(fileVersions).map(
    (file) => new Date(file.createdAt),
  );
  return dates.length ? dateFormat.format(min(dates)) : undefined;
};

const getInitialOfferFile = (
  version: number,
  fileVersions: Record<number, SafeOfferDBFile>,
  msg: ChatMessageAI[],
  initial: OfferFile,
) => {
  if (msg.length > 1 && !isOfferFileInComplete(initial)) {
    return initial;
  }

  return fileVersions[version]?.offerContent ?? initial;
};

const getInitialLineItems = (
  version: number,
  lineItemVersions: Record<number, SafeOfferItem[]>,
  msg: ChatMessageAI[],
  initial: LineItem[],
) => {
  if (msg.length > 1 && initial.length > 0) {
    return initial;
  }

  return (lineItemVersions[version] ?? []).map((item) => {
    const totalPrice = parseFloat(item.totalPrice);
    const pricing = hydratePricingFromStoredTotal(totalPrice);

    return {
      id: item.id,
      description: item.description,
      item: item.item,
      unitPrice: parseFloat(item.unitPrice),
      quantity: item.quantity,
      unit: item.unit,
      totalPrice,
      gstRate: 0.1, // Assuming a default GST rate of 10%
      gstIncluded: true, // Assuming GST is included in the prices
      netLine: pricing.netLine,
      gstAmount: pricing.gstAmount,
    };
  });
};

const getInitialVersion = (
  messages: ChatMessageAI[],
  initialLineItems: LineItem[],
  initialOfferFile: OfferFile,
  initialVersion: number,
) => {
  if (
    messages.length > 1 &&
    initialLineItems.length > 0 &&
    !isOfferFileInComplete(initialOfferFile)
  ) {
    return "current";
  } else {
    return initialVersion === 0 ? "current" : initialVersion;
  }
};

export const ChatProvider = ({
  chatId,
  initialVersionLength = 0,
  initialItemRecord = {},
  initialOfferFileRecord = {},
  initialMessages,
  initialOfferFile = emptyOfferFile,
  initialLineItems = [],
  leadId,
  children,
}: {
  chatId?: string;
  initialVersionLength?: number;
  initialItemRecord?: Record<number, SafeOfferItem[]>;
  initialOfferFileRecord?: Record<number, SafeOfferDBFile>;
  initialMessages: ChatMessageAI[];
  initialOfferFile?: OfferFile;
  initialLineItems?: LineItem[];
  leadId: string;
  children: React.ReactNode;
}) => {
  // Last File Version Created Date
  const [lastRevisionDate, setLastRevisionDate] = useState<string | undefined>(
    getRevisionDate(initialOfferFileRecord),
  );
  const [version, setVersion] = useState<number | "current">(
    getInitialVersion(
      initialMessages,
      initialLineItems,
      initialOfferFile,
      initialVersionLength,
    ),
  );
  const [versionLength, setVersionLength] = useState(initialVersionLength);
  const [lineItemRecord, setLineItemRecord] =
    useState<Record<number, SafeOfferItem[]>>(initialItemRecord);
  const [offerFileRecord, setOfferFileRecord] = useState<
    Record<number, SafeOfferDBFile>
  >(initialOfferFileRecord);
  const [lineItems, setLineItems] = useState<LineItem[]>(() =>
    getInitialLineItems(
      initialVersionLength,
      initialItemRecord,
      initialMessages,
      initialLineItems,
    ),
  );

  const [offerFile, setOfferFile] = useState<OfferFile>(() =>
    getInitialOfferFile(
      initialVersionLength,
      initialOfferFileRecord,
      initialMessages,
      initialOfferFile,
    ),
  );
  const proposalDate = useMemo(
    () => getProposalDate(initialOfferFileRecord),
    [initialOfferFileRecord],
  );

  const {
    messages,
    status,
    sendMessage,
    setMessages,
    resumeStream,
    error,
    stop,
  } = useChat<ChatMessageAI>({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    experimental_throttle: 100,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const {
          leadId: requestLeadId,
          offerFile,
          lineItems,
        } = (request.body ?? {}) as {
          leadId: number;
          offerFile: OfferFile;
          lineItems: LineItem[];
        };

        console.log("Preparing request with body:", {
          leadId: requestLeadId,
          offerFile,
          lineItems,
        });

        // Check if this is a tool approval continuation:
        // - Last message is NOT a user message (meaning no new user input)
        // - OR any message has tool parts that were responded to (approved or denied)
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const state = (part as { state?: string }).state;
              return (
                state === "approval-responded" || state === "output-denied"
              );
            }),
          );

        return {
          body: {
            id: request.id,
            leadId: requestLeadId,
            offerFile,
            lineItems,
            // Send all messages for tool approval continuation, otherwise just the last user message
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      console.log("Data Parts: ", dataPart);
      switch (dataPart.type) {
        case "data-line-item-update": {
          const data = dataPart.data as LineItem;
          setLastRevisionDate(dateFormat.format(new Date()));
          setLineItems((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === data.id);
            if (existingIndex !== -1) {
              const updatedLineItems = [...prev];
              updatedLineItems[existingIndex] = {
                ...prev[existingIndex],
                ...data,
              };
              return updatedLineItems;
            }
            const updated = [...prev, data];
            return updated;
          });
          setVersion("current");
          break;
        }

        case "data-offer-file-update": {
          const offerData = dataPart.data as OfferFilePatchPayload;
          setLastRevisionDate(dateFormat.format(new Date()));
          setOfferFile((prev) => {
            const update = applyOfferFileUpdate(prev, offerData);
            console.log("Offer File Original:", prev);
            console.log("Update Offer Patch: ", offerData);
            console.log("Updated Offer File: ", update);
            return update;
          });
          setVersion("current");
          break;
        }
        default:
          console.log("Received data part:", dataPart);
      }
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  useAutoResume({
    autoResume: true,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const appendVersion = (
    version: number,
    lineItems: SafeOfferItem[],
    offerFile: SafeOfferDBFile,
  ) => {
    setVersion(version);
    setVersionLength((prev) => Math.max(prev, version));
    setLineItemRecord((prev) => ({ ...prev, [version]: lineItems }));
    setOfferFileRecord((prev) => ({ ...prev, [version]: offerFile }));
  };

  const handleSetVersion = (version: number | "current") => {
    if (version === "current") {
      setVersion(version);
      setLineItems((prev) => {
        const newLineItems = extractLineItemsFromMessage(messages);
        return [
          ...prev.filter(
            (item) => !newLineItems.some((newItem) => newItem.id === item.id),
          ),
          ...newLineItems,
        ];
      });
      setOfferFile((prev) => {
        const newOfferFile = extractOfferFileFromMessage(messages, prev);
        return newOfferFile;
      });
      return;
    }
    setVersion(version);
    const newLineItems = lineItemRecord[version] ?? [];
    const newOfferFile =
      offerFileRecord[version]?.offerContent ?? emptyOfferFile;
    setLineItems(() => {
      const update = newLineItems.map((item) => {
        const totalPrice = parseFloat(item.totalPrice);
        const pricing = hydratePricingFromStoredTotal(totalPrice);
        return {
          id: item.id,
          description: item.description,
          item: item.item,
          unitPrice: parseFloat(item.unitPrice),
          quantity: item.quantity,
          unit: item.unit,
          totalPrice,
          gstRate: 0.1,
          gstIncluded: true,
          netLine: pricing.netLine,
          gstAmount: pricing.gstAmount,
        };
      });
      return update;
    });
    setOfferFile(() => {
      return newOfferFile;
    });
  };

  const handleUpdateLineItem = (
    id: string,
    updates: Partial<Pick<LineItem, "unit" | "quantity" | "unitPrice">>,
  ) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = {
          ...item,
          ...updates,
        };

        const totalPrice = updated.quantity * updated.unitPrice;
        const gstAmount = totalPrice * updated.gstRate;
        const netLine = updated.gstIncluded
          ? totalPrice
          : totalPrice + gstAmount;

        return {
          ...updated,
          totalPrice,
          gstAmount,
          netLine,
        };
      }),
    );

    setVersion("current");
  };

  const handleAddLineItem = (lineItem: LineItem) => {
    setLineItems((prev) => [...prev, lineItem]);
    setVersion("current");
  };

  return (
    <ChatContext.Provider
      value={{
        lastRevisionDate,
        proposalDate,
        currentVersion: version,
        versions: versionLength,
        messages,
        status,
        sendMessage: (params) =>
          sendMessage(params, {
            body: { leadId: parseInt(leadId), offerFile, lineItems },
          }),
        setMessages,
        stop,
        error,
        lineItems,
        offerFile,
        setVersion: handleSetVersion,
        appendVersion,
        setLineItems: handleUpdateLineItem,
        addLineItem: handleAddLineItem,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChatContext = () => {
  const context = useContext(ChatContext);

  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }

  return context;
};
