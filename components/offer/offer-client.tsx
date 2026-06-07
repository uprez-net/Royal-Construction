"use client";
import { ChatProvider } from "@/context/ChatContext";
import { OfferChat } from "./offer-chat";
import { OfferFileCanvas } from "./offer-file";
import { ChatMessageAI, STARTING_AGENT_MESSAGE } from "@/types/chat";
import type { File } from "@prisma/client";

interface OfferClientProps {
  leadId: string;
  chatId?: string;
  initialMessages: ChatMessageAI[];
  files: File[];
}

export function OfferClient({
  leadId,
  chatId,
  initialMessages,
  files,
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
      <div className="flex h-screen w-screen flex-1 rounded-lg border bg-popover">
        <div className="flex w-[25vw]">
          <OfferChat />
        </div>

        <div className="flex overflow-hidden flex-1">
          <OfferFileCanvas files={files} leadId={leadId} />
        </div>
      </div>
    </ChatProvider>
  );
}
