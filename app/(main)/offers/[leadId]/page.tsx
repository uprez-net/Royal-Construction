import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { getOfferByLeadIdCached } from "@/lib/data/offers";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";
import OfferDetailsPageSkeleton from "./loading";
import { CreatingOfferClient } from "@/components/offers/offer/creating-offer";

async function OfferCreationContent({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const {
    chatSession: chat,
    files,
    leadInfo,
  } = await getChatByLeadId(parseInt(leadId));
  const offerData = await getOfferByLeadIdCached(parseInt(leadId));

  if (!chat || !offerData || leadInfo.runId !== null) {
    return (
      <CreatingOfferClient runId={leadInfo.runId!} leadId={parseInt(leadId)} />
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
