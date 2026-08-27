"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LeadEmails } from "@prisma/client";

import { DeleteConfirmModal } from "@/components/leads/modal-ui/delete-confirm-modal";
import LeadCommModal from "@/components/leads/modal-ui/lead-comm-modal";
import { FilePickerCancelled, pickFiles, uploadFiles } from "@/components/webmcp/file-upload";
import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import { useAvailableUsers } from "@/hooks/use-available-users";
import { useWebMcpTool } from "@/hooks/use-webmcp-tool";
import type { Lead } from "@/lib/leads/types";

const MAX_UPLOAD_FILES = 5;

import { HbfcClaimCard } from "./hbfc-claim-card";
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

  const handleLeadUpdate = useCallback((updated: Lead) => {
    setLead(updated);
  }, []);

  const handleFilesUploaded = useCallback((files: Lead["uploadedFiles"]) => {
    setLead((current) => ({
      ...current,
      uploadedFiles: [...current.uploadedFiles, ...files],
    }));
  }, []);

  const appendEmailToLead = useCallback((_leadId: number, email: LeadEmails) => {
    setLead((current) => ({ ...current, emails: [email, ...current.emails] }));
  }, []);

  /* ── WebMCP: file upload for this lead ──
     Replaces half of the retired `upload_file` MCP tool. That one took the file
     as base64 in its arguments, which an agent has no way to produce — it has
     never seen the document. This opens the real picker and then runs the same
     client upload the Documents tab runs, so /api/upload writes the File row
     and the header count updates without a reload. */
  useWebMcpTool({
    name: "upload_lead_files",
    title: "Upload files to this lead",
    description:
      "Opens the file picker so the user can attach documents to the lead currently open, then uploads them and adds them to the lead's Documents tab. Returns the file ids and URLs. Use this rather than asking the user to upload manually; you cannot supply file content yourself.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async () => {
      let chosen: File[];
      try {
        chosen = await pickFiles({ multiple: true, maxFiles: MAX_UPLOAD_FILES });
      } catch (error) {
        if (error instanceof FilePickerCancelled) {
          return webMcpError(
            "The file picker closed without a selection. Ask the user to pick the files, then try again.",
          );
        }
        throw error;
      }

      if (chosen.length === 0) {
        return webMcpError("No files were selected.");
      }

      const uploaded = await uploadFiles(chosen, {
        kind: "lead",
        leadId: String(lead.id),
      });

      handleFilesUploaded(uploaded);
      return webMcpJson({
        leadId: lead.id,
        files: uploaded.map(({ id, name, url }) => ({ fileId: id, fileName: name, url })),
      });
    },
  });

  return (
    <div className="space-y-4 pb-4">
      <LeadHeader
        lead={lead}
        onArchiveClick={() => setShowArchiveConfirm(true)}
        onSendTextClick={() => setShowCommModal(true)}
        onLeadUpdate={handleLeadUpdate}
      />

      <HbfcClaimCard leadId={lead.id} />

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
    </div>
  );
}
