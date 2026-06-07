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
      initialMessages={
        initialMessages.length > 0
          ? initialMessages
          : [
              {
                id: "initial-message",
                role: "assistant",
                parts: [{ type: "text", text: STARTING_AGENT_MESSAGE }],
                metadata: { createdAt: new Date().toISOString() },
              },
            ]
      }
      leadId={leadId}
    >
      <div className="flex h-screen w-screen bg-[#F7F6F2] p-4 md:p-6">
        <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <div className="flex w-[25vw] min-w-[320px] border-r border-[#E2E8F0] bg-[#FCFBF8]">
            <OfferChat />
          </div>

          <div className="flex min-w-0 flex-1 overflow-hidden bg-[#FAF8F3]">
            <OfferFileCanvas files={files} leadId={leadId} />
          </div>
        </div>
      </div>
    </ChatProvider>
  );
}
