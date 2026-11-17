"use client";

import { useEffect, useState } from "react";
import { MessageSquareText, Phone } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { markLeadCommsRead } from "@/lib/leads/comms-service";

import { LeadCallsPanel } from "./lead-calls-panel";
import { LeadSmsThread } from "./lead-sms-thread";

export type LeadCommsTab = "calls" | "sms";

/**
 * A lead's phone calls and texts, through whichever provider this deployment
 * uses (Twilio or Telnyx — the screen never says which). Opened from the
 * lead page and the lead list.
 *
 * Opening it is reading it: the lead's unread texts and the calls Mili or the
 * voicemail took are marked read as soon as it opens, whichever tab is
 * showing, and `onRead` lets the opener clear its badge.
 */
export function LeadCommsModal({
  lead,
  initialTab = "calls",
  onClose,
  onRead,
}: {
  lead: { id: number; name: string };
  initialTab?: LeadCommsTab;
  onClose: () => void;
  onRead?: () => void;
}) {
  const [tab, setTab] = useState<LeadCommsTab>(initialTab);
  useEffect(() => {
    // Not cancelled on close: telling the opener to refresh its badge after
    // the window has gone is still right.
    markLeadCommsRead(lead.id).then(
      ({ marked }) => {
        if (marked.calls + marked.sms > 0) onRead?.();
      },
      // The badge stays until the next open: unread is the safe side to err.
      (error: unknown) =>
        console.warn(
          "[comms] Could not mark the lead's calls and texts read",
          error instanceof Error ? error.message : error,
        ),
    );
    // Once per opening: a parent re-render passing a new onRead is not a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);
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
        <TabsList aria-label="Communication type" className="self-start">
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
