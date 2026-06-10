import { OfferClient } from "@/components/offers/offer/offer-client";
import { getChatByLeadId } from "@/lib/data/chat";
import { getOfferByLeadIdCached } from "@/lib/data/offers";
import { convertToUIMessage } from "@/utils/chat";
import { Suspense } from "react";
import { Sparkles } from "lucide-react";

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

  if (!chat || !offerData) {
    return (
      <div className="flex min-h-100 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
            </div>

            <div>
              <h3 className="font-semibold">Generating Your Offer</h3>
              <p className="text-sm text-muted-foreground">
                Analyzing project details and preparing documents...
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {/* Animated indeterminate progress */}
            <div className="relative h-2 overflow-hidden rounded-full bg-muted">
              <div className="absolute inset-y-0 left-0 w-1/3 animate-[loader_2s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Please wait</span>
              <span>AI is working...</span>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="animate-pulse">✓ Reading files</div>
            <div className="animate-pulse delay-150">
              ✓ Extracting requirements
            </div>
            <div className="animate-pulse delay-300">
              ✓ Building offer structure
            </div>
          </div>
        </div>
      </div>
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
    <Suspense fallback={<div>Loading...</div>}>
      <OfferCreationContent params={params} />
    </Suspense>
  );
}
