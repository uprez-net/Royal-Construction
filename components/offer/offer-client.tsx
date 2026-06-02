"use client";
import { ChatProvider } from "@/context/ChatContext";
import { OfferChat } from "./offer-chat";
import { OfferFileCanvas } from "./offer-file";
import { ChatMessageAI, STARTING_AGENT_MESSAGE } from "@/types/chat";

interface OfferClientProps {
  leadId: string;
  chatId?: string;
  initialMessages: ChatMessageAI[];
}

export function OfferClient({
  leadId,
  chatId,
  initialMessages,
}: OfferClientProps) {
  return (
    <ChatProvider
      chatId={chatId}
      initialMessages={initialMessages.length > 0 ? initialMessages : [{
        id: "initial-message",
        role: "assistant",
        parts: [{ type: "text", text: STARTING_AGENT_MESSAGE }],
        metadata: { createdAt: new Date().toISOString() },
      }]}
      leadId={leadId}
    >
      <div className="grid h-full min-h-0 min-w-0 grid-cols-1 lg:grid-cols-12">
        <div className="flex min-h-0 min-w-0 overflow-hidden border-slate-200/60 lg:col-span-4 lg:border-r">
          <OfferChat />
        </div>

        <div className="flex min-h-0 min-w-0 overflow-hidden bg-slate-50/30 lg:col-span-8">
          <OfferFileCanvas />
        </div>
      </div>
    </ChatProvider>
  );
}
