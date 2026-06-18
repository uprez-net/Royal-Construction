import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { getOfferByLeadIdCached } from "@/lib/data/offers";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";
import OfferDetailsPageSkeleton from "./loading";
import { CreatingOfferClient } from "@/components/offers/offer/creating-offer";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata(
  { params }: { params: Promise<{ leadId: string }>; }
): Promise<Metadata> {
  const { leadId } = await params;
  const parsedLeadId = Number(leadId);
  const offerData = await getOfferByLeadIdCached(parsedLeadId);

  if (offerData) {
    return {
      title: `Lead: #${leadId} Offer Details`,
      description: `Details and management for offer related to lead #${leadId}, ${offerData.lead.name}.`,
    };
  } else {
    return {
      title: `Lead: #${leadId} Creating Offer`,
      description: `Creating offer for lead #${leadId}.`,
    };
  }
}


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
