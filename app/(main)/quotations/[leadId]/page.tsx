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
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div
        className={cn(
          "relative h-screen w-screen overflow-hidden",
          "bg-[#0f1419] text-[#f7f9fc] antialiased",
        )}
      >
        {/* Main canvas */}
        <OfferClient
          leadId={leadId}
          chatId={chat?.id}
          initialMessages={
            chat?.messages ? [...convertToUIMessage(chat.messages)] : []
          }
        />
      </div>
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
