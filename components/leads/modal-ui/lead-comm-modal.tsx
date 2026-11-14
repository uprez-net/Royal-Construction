import { Mail } from "lucide-react";

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
}

export default function LeadCommModal({
  lead,
  isOpen,
  onClose,
  appendEmailToLead,
}: LeadCommModalProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Mail className="size-4 text-royal-gold-ink" aria-hidden="true" />
          Email · {lead.name}
        </span>
      }
      maxWidthClass="max-w-[760px]"
      bodyClassName="min-h-0 overflow-y-auto p-3 sm:p-4"
      isFullScreenable
      isFullScreen={isFullScreen}
      onToggleFullScreen={(minimize) =>
        setIsFullScreen(minimize ? false : true)
      }
    >
      <LeadEmailSection
        key={lead.emails.length}
        emails={lead.emails}
        leadId={lead.id}
        leadEmail={lead.email}
        projectType={lead.type}
        location={lead.location}
        isFullScreen={isFullScreen}
        appendEmailToLead={appendEmailToLead}
      />
    </ModalShell>
  );
}
