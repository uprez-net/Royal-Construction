
import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";

async function OfferCreationContent({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const { chatSession: chat, files, leadInfo } = await getChatByLeadId(parseInt(leadId));

  return (
    <OfferClient
      leadId={leadId}
      chatId={chat?.id}
      initialMessages={
        chat?.messages ? [...convertToUIMessage(chat.messages)] : []
      }
      files={files}
      leadInfo={leadInfo}
    />
  );
}

export default function OfferCreationPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OfferCreationContent params={params} />
    </Suspense>
  );
}
