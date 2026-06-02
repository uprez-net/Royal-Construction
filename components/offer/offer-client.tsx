"use client";
import { ChatProvider } from "@/context/ChatContext";
import { OfferChat } from "./offer-chat";
import { OfferFileCanvas } from "./offer-file";
import { ChatMessageAI } from "@/types/chat";

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
      initialMessages={initialMessages}
      leadId={leadId}
    >
      <main className="absolute inset-0 z-0">
        <div className="relative h-full basis-[30%] min-w-0 border-l border-white/10">
          <OfferChat />
        </div>
        <div className="relative h-full basis-[70%] min-w-0">
          <OfferFileCanvas />
        </div>
      </main>
    </ChatProvider>
  );
}
