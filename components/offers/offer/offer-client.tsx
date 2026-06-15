"use client";
import { ChatProvider } from "@/context/ChatContext";
import { OfferChat } from "./offer-chat";
import { OfferFileCanvas } from "./offer-file";
import { ChatMessageAI } from "@/types/chat";
import type { File } from "@prisma/client";
import {
  extractLineItemsFromMessage,
  extractOfferFileFromMessage,
  setInitialAgentMessage,
} from "@/utils/chat";
import { SafeOfferDBFile, SafeOfferItem } from "@/types/offer";

interface OfferClientProps {
  leadId: string;
  chatId?: string;
  initialVersion: number;
  initialItemRecord: Record<number, SafeOfferItem[]>;
  initialOfferFileRecord: Record<number, SafeOfferDBFile>;
  initialMessages: ChatMessageAI[];
  files: File[];
  leadInfo: {
    name: string;
    location: string;
    type: string;
  };
}

export function OfferClient({
  leadId,
  chatId,
  initialMessages,
  files,
  leadInfo,
  initialVersion,
  initialItemRecord,
  initialOfferFileRecord,
}: OfferClientProps) {
  return (
    <ChatProvider
      chatId={chatId}
      initialMessages={setInitialAgentMessage(initialMessages)}
      initialOfferFile={extractOfferFileFromMessage(initialMessages)}
      initialLineItems={extractLineItemsFromMessage(initialMessages)}
      leadId={leadId}
      initialVersionLength={initialVersion}
      initialItemRecord={initialItemRecord}
      initialOfferFileRecord={initialOfferFileRecord}
    >
      <div className="flex min-h-[50vh] w-full flex-col bg-[#F7F6F2] p-3 sm:p-4 md:p-6 lg:h-[85vh]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] lg:flex-row">
          <div className="flex max-h-[55vh] w-full shrink-0 border-b border-[#E2E8F0] bg-[#FCFBF8] lg:max-h-none lg:w-[25vw] lg:min-w-[320px] lg:border-r lg:border-b-0">
            <OfferChat />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#FAF8F3]">
            <OfferFileCanvas
              files={files}
              leadId={leadId}
              customerName={leadInfo.name}
              projectType={leadInfo.type}
              location={leadInfo.location}
            />
          </div>
        </div>
      </div>
    </ChatProvider>
  );
}
