import { ChatMessageAI } from "@/types/chat";
import { ChatStatus, DefaultChatTransport } from "ai";
import { createContext, useContext, useMemo, useState } from "react";
import { useChat, UseChatHelpers } from "@ai-sdk/react";
import { fetchWithErrorHandlers } from "@/utils/chat-error";
import { v4 as generateUUID } from "uuid";
import { useAutoResume } from "@/hooks/use-auto-resume";
import {
  extractLineItemsFromMessage,
  extractOfferFileFromMessage,
  mergeServiceItems,
  ServiceItem,
} from "@/utils/chat";
import { SafeOfferDBFile, SafeOfferItem } from "@/types/offer";
import { max, min } from "date-fns";
import { dateFormat } from "@/utils/formatters";
import type {
  FacadeOptionWithImageUrl,
  TermsAndConditionsItem,
} from "@/lib/agent/offer-prompts";

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
  if (msg.length > 1) {
    return initial;
  } else {
    return fileVersions[version].offerContent;
  }
};

const getInitialLineItems = (
  version: number,
  lineItemVersions: Record<number, SafeOfferItem[]>,
  msg: ChatMessageAI[],
  initial: LineItem[],
) => {
  if (msg.length > 1) {
    return initial;
  } else {
    return lineItemVersions[version].map((item) => ({
      id: item.id,
      description: item.description,
      item: item.item,
      unitPrice: parseFloat(item.unitPrice),
      quantity: item.quantity,
      unit: item.unit,
      totalPrice: parseFloat(item.totalPrice),
      gstRate: 0.1, // Assuming a default GST rate of 10%
      gstIncluded: true, // Assuming GST is included in the prices
      netLine: parseFloat(item.totalPrice) - parseFloat(item.totalPrice) * 0.1, // Calculate net line by removing GST from total price
      gstAmount: parseFloat(item.totalPrice) * 0.1, // Calculate GST amount based on total price and GST rate
    }));
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
    initialMessages.length > 1 ? "current" : initialVersionLength,
  );
  const [versionLength, setVersionLength] = useState(initialVersionLength);
  const [lineItemRecord, setLineItemRecord] =
    useState<Record<number, SafeOfferItem[]>>(initialItemRecord);
  const [offerFileRecord, setOfferFileRecord] = useState<
    Record<number, SafeOfferDBFile>
  >(initialOfferFileRecord);
  const [lineItems, setLineItems] = useState<LineItem[]>(
    getInitialLineItems(
      initialVersionLength,
      initialItemRecord,
      initialMessages,
      initialLineItems,
    ),
  );
  const [offerFile, setOfferFile] = useState<OfferFile>(
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
            leadId,
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
            return [...prev, data];
          });
          break;
        }

        case "data-offer-file-update": {
          const offerData = dataPart.data as OfferFile;
          setLastRevisionDate(dateFormat.format(new Date()));
          setOfferFile((prev) => ({
            ...prev,
            ...offerData,
            termsAndConditions:
              offerData.termsAndConditions ?? prev.termsAndConditions,
            projectScope: offerData.projectScope
              ? mergeServiceItems(
                  prev.projectScope ?? [],
                  offerData.projectScope,
                )
              : prev.projectScope,
            fixedPriceItems: offerData.fixedPriceItems ?? prev.fixedPriceItems,
            promotionalUpgrades:
              offerData.promotionalUpgrades ?? prev.promotionalUpgrades,
          }));
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
      setLineItems(extractLineItemsFromMessage(initialMessages));
      setOfferFile(extractOfferFileFromMessage(messages));
      return;
    }
    setVersion(version);
    const newLineItems = lineItemRecord[version] ?? [];
    const newOfferFile =
      offerFileRecord[version]?.offerContent ?? emptyOfferFile;
    setLineItems(
      newLineItems.map((item) => ({
        id: item.id,
        description: item.description,
        item: item.item,
        unitPrice: parseFloat(item.unitPrice),
        quantity: item.quantity,
        unit: item.unit,
        totalPrice: parseFloat(item.totalPrice),
        gstRate: 0.1, // Assuming a default GST rate of 10%
        gstIncluded: true, // Assuming GST is included in the prices
        netLine:
          parseFloat(item.totalPrice) - parseFloat(item.totalPrice) * 0.1, // Calculate net line by removing GST from total price
        gstAmount: parseFloat(item.totalPrice) * 0.1, // Calculate GST amount based on total price and GST rate
      })),
    );
    setOfferFile(newOfferFile);
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
        sendMessage,
        setMessages,
        stop,
        error,
        lineItems,
        offerFile,
        setVersion: handleSetVersion,
        appendVersion,
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
