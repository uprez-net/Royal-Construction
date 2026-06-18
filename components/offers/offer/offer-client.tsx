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
import { useEffect, useRef } from "react";
import { toast } from "sonner";

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
  const toastIdRef = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    if (toastIdRef.current) return;
    toastIdRef.current = toast.info(
      "Update the Line Items to regenerate the offer",
      {
        description:
          "You can edit any field in the line items and based on the changes, the offer will be regenerated.",
        duration: 10000,
        dismissible: true,
      },
    );
  }, []);
  
  return (
    <ChatProvider
      chatId={chatId}
      initialMessages={setInitialAgentMessage(initialMessages)}
      initialOfferFile={extractOfferFileFromMessage(
        initialMessages,
        initialOfferFileRecord[initialVersion].offerContent,
      )}
      initialLineItems={extractLineItemsFromMessage(initialMessages)}
      leadId={leadId}
      initialVersionLength={initialVersion}
      initialItemRecord={initialItemRecord}
      initialOfferFileRecord={initialOfferFileRecord}
    >
      <div className="flex min-h-[calc(100svh-96px)] w-full flex-col bg-background p-3 sm:p-4 md:p-6 lg:h-[calc(100svh-96px)] lg:min-h-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm lg:flex-row">
          <div className="flex max-h-[48svh] w-full shrink-0 border-b border-border/70 bg-card lg:max-h-none lg:w-[24rem] lg:border-r lg:border-b-0 xl:w-100">
            <OfferChat />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/30">
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
