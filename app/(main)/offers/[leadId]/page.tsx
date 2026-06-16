import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { getOfferByLeadIdCached } from "@/lib/data/offers";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";
import OfferDetailsPageSkeleton from "./loading";
import { CreatingOfferClient } from "@/components/offers/offer/creating-offer";
import { notFound } from "next/navigation";

async function OfferCreationContent({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const parsedLeadId = Number(leadId);

  if (!Number.isInteger(parsedLeadId) || parsedLeadId <= 0) {
    notFound();
  }

  const [chatData, offerData] = await Promise.all([
    getChatByLeadId(parsedLeadId),
    getOfferByLeadIdCached(parsedLeadId),
  ]);

  const {
    chatSession: chat,
    files,
    leadInfo,
  } = chatData;

  if (!chat || !offerData || leadInfo.runStatus !== "COMPLETED") {
    return (
      <CreatingOfferClient
        runId={leadInfo.runId}
        leadId={parsedLeadId}
        updatedAt={leadInfo.updatedAt}
        runStatus={leadInfo.runStatus}
      />
    );
  }

  return (
    <OfferClient
      leadId={leadId}
      chatId={chat?.id}
      initialMessages={
        chat?.messages ? [...convertToUIMessage(chat.messages)] : []
      }
      files={files}
      leadInfo={leadInfo}
      initialVersion={offerData?.version ?? 0}
      initialItemRecord={offerData?.items ?? {}}
      initialOfferFileRecord={offerData?.files ?? {}}
    />
  );
}

export default function OfferCreationPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  return (
    <Suspense fallback={<OfferDetailsPageSkeleton />}>
      <OfferCreationContent params={params} />
    </Suspense>
  );
}
