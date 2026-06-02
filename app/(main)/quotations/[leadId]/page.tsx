import { OfferClient } from "@/components/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { cn } from "@/lib/utils";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";

async function OfferCreationContent({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const chat = await getChatByLeadId(parseInt(leadId));

  return (
    <div className="flex h-full min-h-0 flex-1">
      <section className="flex flex-1 overflow-hidden rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm backdrop-blur">
        <OfferClient
          leadId={leadId}
          chatId={chat?.id}
          initialMessages={
            chat?.messages ? [...convertToUIMessage(chat.messages)] : []
          }
        />
      </section>
    </div>
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
