"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LeadEmails } from "@prisma/client";

import { DeleteConfirmModal } from "@/components/leads/modal-ui/delete-confirm-modal";
import LeadCommModal from "@/components/leads/modal-ui/lead-comm-modal";
import { LeadWhatsAppModal } from "@/components/leads/whatsapp/lead-whatsapp-modal";
import { LeadCommsModal } from "@/components/leads/comms/lead-comms-modal";
import { useCommsAvailability } from "@/hooks/use-comms-availability";
import { useAvailableUsers } from "@/hooks/use-available-users";
import type { Lead } from "@/lib/leads/types";

import { HbcfClaimCard } from "./hbcf-claim-card";
import { LeadDetailTabs } from "./lead-detail-tabs";
import { LeadHeader } from "./lead-header";

/**
 * Bridges the leads modals, which take an imperative `showToast`, onto sonner —
 * the toast surface the rest of the detail pages use, already mounted in the
 * root layout.
 */
function showToast(message: string, type?: "success" | "info" | "error") {
  if (type === "error") toast.error(message);
  else if (type === "info") toast.info(message);
  else toast.success(message);
}

export function LeadDetailScreen({ lead: initialLead }: { lead: Lead }) {
  const router = useRouter();
  const availableUsers = useAvailableUsers();
  // The server payload seeds the page; in-page saves return the updated lead,
  // so every tab reads one live copy rather than a stale render.
  const [lead, setLead] = useState<Lead>(initialLead);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showCommModal, setShowCommModal] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const comms = useCommsAvailability();

  const handleLeadUpdate = useCallback((updated: Lead) => {
    setLead(updated);
  }, []);

  const handleFilesUploaded = useCallback((files: Lead["uploadedFiles"]) => {
    setLead((current) => ({
      ...current,
      uploadedFiles: [...current.uploadedFiles, ...files],
    }));
  }, []);

  const appendEmailToLead = useCallback(
    (_leadId: number, email: LeadEmails) => {
      setLead((current) => ({
        ...current,
        emails: [email, ...current.emails],
      }));
    },
    [],
  );

  return (
    <div className="space-y-4 pb-4">
      <LeadHeader
        lead={lead}
        onArchiveClick={() => setShowArchiveConfirm(true)}
        onSendTextClick={() => setShowCommModal(true)}
        onWhatsAppClick={() => setShowWhatsApp(true)}
        onPhoneClick={
          comms.calls || comms.sms ? () => setShowPhone(true) : undefined
        }
        onLeadUpdate={handleLeadUpdate}
      />

      <HbcfClaimCard
        leadId={lead.id}
        estimatedStartDate={lead.estimatedStartDate}
      />

      <LeadDetailTabs
        lead={lead}
        availableUsers={availableUsers}
        onLeadUpdate={handleLeadUpdate}
        onFilesUploaded={handleFilesUploaded}
      />

      {showArchiveConfirm ? (
        <DeleteConfirmModal
          lead={lead}
          onClose={() => setShowArchiveConfirm(false)}
          onDeleted={() => {
            setShowArchiveConfirm(false);
            // An archived lead drops out of the default list view, so returning
            // there is the honest destination — staying would leave the page
            // showing a record the operator can no longer act on.
            router.push("/leads");
            router.refresh();
          }}
          showToast={showToast}
        />
      ) : null}

      {showCommModal ? (
        <LeadCommModal
          key={lead.emails.length}
          lead={lead}
          isOpen={showCommModal}
          onClose={() => setShowCommModal(false)}
          appendEmailToLead={appendEmailToLead}
        />
      ) : null}

      {showPhone ? (
        <LeadCommsModal
          key={lead.id}
          lead={lead}
          initialTab={comms.calls ? "calls" : "sms"}
          onClose={() => setShowPhone(false)}
        />
      ) : null}

      {/* The same component the leads list opens — one thread, not two. */}
      {showWhatsApp ? (
        <LeadWhatsAppModal
          key={lead.id}
          lead={lead}
          onClose={() => setShowWhatsApp(false)}
        />
      ) : null}
    </div>
  );
}
