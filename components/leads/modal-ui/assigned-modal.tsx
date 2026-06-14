import React, { useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { updateLead } from "@/lib/leads/leads-service";

interface AssignedModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
  availableUsers: { id: string; name: string }[];
}

export function AssignedModal({
  lead,
  onClose,
  onLeadUpdate,
  showToast,
  availableUsers,
}: AssignedModalProps) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const updated = await updateLead(lead.id, {
        assignedId: selectedUserId || null,
      });
      if (!updated) {
        showToast("Failed to assign user", "error");
        return;
      }

      const assignedUserName =
        availableUsers.find((u) => u.id === selectedUserId)?.name ||
        "Unassigned";

      onLeadUpdate(updated);
      showToast(`Assigned ${assignedUserName} to ${updated.name}`, "success");
      onClose();
    } catch (error) {
      console.error("Failed to update assigned", error);
      showToast("Failed to assign user. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Assign Lead"
      subtitle={`Assign ${lead.name} to:`}
      maxWidthClass="max-w-[400px]"
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-[#78716c]">
            Assigned To
          </label>
          <select
            className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="" disabled>
              Select a person
            </option>
            {availableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] ${selectedUserId ? "" : "cursor-not-allowed opacity-50"}`}
            onClick={handleSave}
            disabled={!selectedUserId || saving}
          >
            {saving ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Assigning User ...
              </>
            ) : (
              "Save Assignment"
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
