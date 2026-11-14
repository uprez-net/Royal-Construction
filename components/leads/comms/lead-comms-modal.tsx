"use client";

import { useState } from "react";
import { MessageSquareText, Phone } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { LeadCallsPanel } from "./lead-calls-panel";
import { LeadSmsThread } from "./lead-sms-thread";

export type LeadCommsTab = "calls" | "sms";

/**
 * A lead's phone calls and texts, through whichever provider this deployment
 * uses (Twilio or Telnyx — the screen never says which). Opened from the
 * lead page and the lead list.
 */
export function LeadCommsModal({
  lead,
  initialTab = "calls",
  onClose,
}: {
  lead: { id: number; name: string };
  initialTab?: LeadCommsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<LeadCommsTab>(initialTab);
  return (
    <ModalShell
      open
      onClose={onClose}
      title={`Phone & SMS · ${lead.name}`}
      maxWidthClass="max-w-[640px]"
      // The panels own their scrolling; the padding is restored here because
      // replacing the body class drops the shell's own.
      bodyClassName="flex min-h-0 flex-col overflow-hidden px-4 pb-4 pt-3 sm:px-5"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as LeadCommsTab)}
        className="flex h-[min(70dvh,620px)] min-h-0 flex-col gap-4"
      >
        <TabsList className="self-start">
          <TabsTrigger value="calls">
            <Phone className="size-4" aria-hidden="true" />
            Calls
          </TabsTrigger>
          <TabsTrigger value="sms">
            <MessageSquareText className="size-4" aria-hidden="true" />
            SMS
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calls" className="flex min-h-0 flex-1 flex-col">
          <LeadCallsPanel lead={lead} />
        </TabsContent>
        <TabsContent value="sms" className="flex min-h-0 flex-1 flex-col">
          <LeadSmsThread lead={lead} />
        </TabsContent>
      </Tabs>
    </ModalShell>
  );
}
