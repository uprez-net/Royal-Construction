import { ChatMessageAI } from "@/types/chat";
import { ChatStatus, DefaultChatTransport } from "ai";
import { createContext, useContext, useState } from "react";
import { useChat, UseChatHelpers } from "@ai-sdk/react";
import { fetchWithErrorHandlers } from "@/utils/chat-error";
import { v4 as generateUUID } from "uuid";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { extractLineItemsFromMessage, extractOfferFileFromMessage, mergeServiceItems, ServiceItem } from "@/utils/chat";
import { SafeOfferDBFile, SafeOfferItem } from "@/types/offer";

interface ChatContextValue {
  lineItems: LineItem[];
  offerFile: OfferFile;
  versions: number;
  currentVersion: number | 'current';
  messages: ChatMessageAI[];
  status: ChatStatus;
  error?: Error;
  sendMessage: UseChatHelpers<ChatMessageAI>["sendMessage"];
  setMessages: UseChatHelpers<ChatMessageAI>["setMessages"];
  setVersion: (version: number | 'current') => void;
  appendVersion: (version: number, lineItems: SafeOfferItem[], offerFile: SafeOfferDBFile) => void;
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
  termsAndConditions?: string[];
  projectDescription?: string;
  paymentTerms?: string;
  serviceInclusions?: ServiceItem[];
  serviceExclusions?: string[];
  serviceExclusionsFootnote?: string;
}

const emptyOfferFile: OfferFile = {
  termsAndConditions: [],
  projectDescription: "",
  paymentTerms: "",
  serviceInclusions: [],
  serviceExclusions: [],
};

export const ChatContext = createContext<ChatContextValue | undefined>(
  undefined,
);

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
  const [version, setVersion] = useState<number | 'current'>('current');
  const [versionLength, setVersionLength] = useState(initialVersionLength);
  const [lineItemRecord, setLineItemRecord] = useState<Record<number, SafeOfferItem[]>>(initialItemRecord);
  const [offerFileRecord, setOfferFileRecord] = useState<Record<number, SafeOfferDBFile>>(initialOfferFileRecord);
  const [lineItems, setLineItems] = useState<LineItem[]>(initialLineItems);
  const [offerFile, setOfferFile] = useState<OfferFile>(initialOfferFile);
  const { messages, status, sendMessage, setMessages, resumeStream, error } =
    useChat<ChatMessageAI>({
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
          case "data-line-item-update":
            // For line item updates, we want to update the relevant message in the chat with the new line item data
            const data = dataPart.data as LineItem;
            setLineItems((prev) => {
              const existingIndex = prev.findIndex(
                (item) => item.id === data.id,
              );
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

          case "data-offer-file-update":
            // For offer file updates and line item updates, we want to update the relevant message in the chat with the new data
            const offerData = dataPart.data as OfferFile;
            setOfferFile((prev) => ({
              ...prev,
              ...offerData,
              termsAndConditions: [
                ...(prev.termsAndConditions ?? []),
                ...(offerData.termsAndConditions ?? []),
              ].flat(),
              serviceInclusions: mergeServiceItems(
                prev.serviceInclusions ?? [],
                offerData.serviceInclusions ?? [],
              ),
              serviceExclusions: [
                ...(prev.serviceExclusions ?? []),
                ...(offerData.serviceExclusions ?? []),
              ].flat(),
            }));
          default:
            // For now, just log all data parts. In the future, you can handle different types of data parts as needed.
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

  const appendVersion = (version: number, lineItems: SafeOfferItem[], offerFile: SafeOfferDBFile) => {
    setVersion(version);
    setVersionLength((prev) => Math.max(prev, version));
    setLineItemRecord((prev) => ({ ...prev, [version]: lineItems }));
    setOfferFileRecord((prev) => ({ ...prev, [version]: offerFile }));
  };

  const handleSetVersion = (version: number | 'current') => {
    if (version === 'current') {
      setVersion(version);
      setLineItems(extractLineItemsFromMessage(initialMessages));
      setOfferFile(extractOfferFileFromMessage(messages));
      return;
    }
    setVersion(version);
    const newLineItems = lineItemRecord[version] ?? [];
    const newOfferFile = offerFileRecord[version]?.offerContent ?? emptyOfferFile;
    setLineItems(newLineItems.map((item) => ({
      id: item.id,
      description: item.description,
      item: item.item,
      unitPrice: parseFloat(item.unitPrice),
      quantity: item.quantity,
      unit: item.unit,
      totalPrice: parseFloat(item.totalPrice),
      gstRate: 0.10, // Assuming a default GST rate of 10%
      gstIncluded: true, // Assuming GST is included in the prices
      netLine: parseFloat(item.totalPrice) - (parseFloat(item.totalPrice) * 0.10), // Calculate net line by removing GST from total price
      gstAmount: parseFloat(item.totalPrice) * 0.10, // Calculate GST amount based on total price and GST rate
    })));
    setOfferFile(newOfferFile);
  }

  return (
    <ChatContext.Provider
      value={{
        currentVersion: version,
        versions: versionLength,
        messages,
        status,
        sendMessage,
        setMessages,
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
