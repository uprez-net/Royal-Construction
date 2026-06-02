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
      <div className="grid h-full min-h-0 grid-cols-12">
        <div className="col-span-4 min-w-0 min-h-0 border-r border-slate-200/60">
          <OfferChat />
        </div>

         <div className="col-span-8 min-w-0 min-h-0 bg-slate-50/30">
          <OfferFileCanvas />
        </div>
      </div>
    </ChatProvider>
  );
}
