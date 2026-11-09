"use client";

import { useState } from "react";

import { ModalShell } from "@/components/common/modal-shell";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import { cn } from "@/lib/utils";

import { LeadWhatsAppConversation } from "./lead-whatsapp-conversation";
import { WhatsAppCallButton } from "./whatsapp-call-button";

export type LeadWhatsAppModalLead = {
  id: number;
  name: string;
};

/**
 * A lead's WhatsApp conversation in a modal (issue #333).
 *
 * The leads list, the lead page and the follow-ups view all open this; the
 * conversation itself is LeadWhatsAppConversation, which the project's
 * Communications tab renders too.
 */
export function LeadWhatsAppModal({
  lead,
  onClose,
}: {
  lead: LeadWhatsAppModalLead;
  onClose: () => void;
}) {
  const [isFullScreen, setIsFullScreen] = useState(false);

  return (
    <ModalShell
      open
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <WhatsAppGlyph brand className="size-4.5" />
          WhatsApp
        </span>
      }
      maxWidthClass="max-w-[760px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) => setIsFullScreen(!minimize)}
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <LeadWhatsAppConversation
        lead={lead}
        headerActions={<WhatsAppCallButton lead={lead} />}
        className={cn(isFullScreen ? "h-full flex-1" : "h-[min(72dvh,680px)]")}
      />
    </ModalShell>
  );
}
