import React, { useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { deleteLead } from "@/lib/leads/leads-service";

interface DeleteConfirmModalProps {
  lead: Lead;
  onClose: () => void;
  onDeleted: (leadId: number) => void;
  showToast: (msg: string, type?: "success" | "info") => void;
}

export function DeleteConfirmModal({
  lead,
  onClose,
  onDeleted,
  showToast,
}: DeleteConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    try {
      setLoading(true);
      await deleteLead(lead.id);
      onDeleted(lead.id);
      showToast("Lead deleted Successfully");
      onClose();
    } catch (error) {
      console.error("Failed to delete lead", error);
      showToast("Failed to delete lead", "info");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Delete Lead"
      maxWidthClass="max-w-[420px]"
    >
      <div className="space-y-4">
        <p className="text-sm text-[#78716c]">
          This will permanently delete {lead.name}. This action cannot be undone.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-[#dc2626] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#b91c1c]"
            onClick={handleDelete}
          >
            {loading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Deleting Lead...
              </>
            ) : (
              "Delete"
            )}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}