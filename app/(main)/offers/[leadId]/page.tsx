
import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { getOfferByLeadIdCached } from "@/lib/data/offers";
import { convertToUIMessage } from "@/utils/chat";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";

async function OfferCreationContent({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const { chatSession: chat, files, leadInfo } = await getChatByLeadId(parseInt(leadId));
  const offerData = await getOfferByLeadIdCached(parseInt(leadId));

  // if(!chat || !offerData) {
  //   return (
  //     <div className="p-4">
  //       <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
  //       <p>Your offer is being generated...</p>
  //     </div>
  //   );
  // }

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
    <Suspense fallback={<div>Loading...</div>}>
      <OfferCreationContent params={params} />
    </Suspense>
  );
}
