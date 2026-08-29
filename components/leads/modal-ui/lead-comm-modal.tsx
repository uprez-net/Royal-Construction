import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { LeadEmailSection } from "./email-section";
import type { LeadEmails } from "@prisma/client";
import { useState } from "react";

interface LeadCommModalProps {
  lead: Lead;
  isOpen: boolean;
  onClose: () => void;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
  /** Draft to open the composer with, from the WebMCP send tool. */
  initialDraft?: string;
  /** Message that draft replies to, by id. */
  initialReplyToId?: string;
}

export default function LeadCommModal({
  lead,
  isOpen,
  onClose,
  appendEmailToLead,
  initialDraft,
  initialReplyToId,
}: LeadCommModalProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title={`${lead.name} - Messages`}
      maxWidthClass="max-w-[720px]"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) => setIsFullScreen(minimize ? false : true)}
    >
      {/* Emails */}
      <LeadEmailSection
        key={lead.emails.length}
        emails={lead.emails}
        leadId={lead.id}
        leadEmail={lead.email}
        projectType={lead.type}
        location={lead.location}
        isFullScreen={isFullScreen}
        appendEmailToLead={appendEmailToLead}
        initialDraft={initialDraft}
        initialReplyToId={initialReplyToId}
      />
    </ModalShell>
  );
}
