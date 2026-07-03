import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { LeadEmailSection } from "./email-section";
import type { LeadEmails } from "@prisma/client";

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
  appendEmailToLead
}: LeadCommModalProps) {
  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title={`${lead.name} - Messages`}
      maxWidthClass="max-w-[720px]"
    >
      {/* Emails */}
      <LeadEmailSection
        key={`${lead.emails.length}-${lead.id}`} // Force re-render when emails change
        emails={lead.emails}
        leadId={lead.id}
        leadEmail={lead.email}
        projectType={lead.type}
        location={lead.location}
        appendEmailToLead={appendEmailToLead}
      />
    </ModalShell>
  );
}
