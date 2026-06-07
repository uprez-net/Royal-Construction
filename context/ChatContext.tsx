import { ChatMessageAI } from "@/types/chat";
import { ChatStatus, DefaultChatTransport } from "ai";
import { createContext, useContext, useState } from "react";
import { useChat, UseChatHelpers } from "@ai-sdk/react";
import { fetchWithErrorHandlers } from "@/utils/chat-error";
import { v4 as generateUUID } from "uuid";
import { useAutoResume } from "@/hooks/use-auto-resume";

interface ChatContextValue {
  lineItems: LineItem[];
  offerFile: OfferFile;
  messages: ChatMessageAI[];
  status: ChatStatus;
  sendMessage: UseChatHelpers<ChatMessageAI>["sendMessage"];
  setMessages: UseChatHelpers<ChatMessageAI>["setMessages"];
  error?: Error;
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
  termsAndConditions?: string;
  projectDescription?: string;
  paymentTerms?: string;
  serviceInclusions?: string[];
  serviceExclusions?: string[];
}

const emptyOfferFile: OfferFile = {
  termsAndConditions: "",
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
  initialMessages,
  initialOfferFile = emptyOfferFile,
  initialLineItems = [],
  leadId,
  children,
}: {
  chatId?: string;
  initialMessages: ChatMessageAI[];
  initialOfferFile?: OfferFile;
  initialLineItems?: LineItem[];
  leadId: string;
  children: React.ReactNode;
}) => {
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

  return (
    <ChatContext.Provider
      value={{
        messages,
        status,
        sendMessage,
        setMessages,
        error,
        lineItems,
        offerFile,
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
