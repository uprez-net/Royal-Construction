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
  const selectId = React.useId();
  const helperId = `${selectId}-helper`;
  const inputCls =
    "mt-1 w-full rounded-[4px] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-[color:var(--royal-gold)] focus:outline-none focus:ring-2 focus:ring-[color:var(--royal-gold-light)]";

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
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-muted-foreground"
          >
            Assigned To
          </label>
          <select
            id={selectId}
            className={inputCls}
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            required
            aria-describedby={!selectedUserId ? helperId : undefined}
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
          {!selectedUserId && (
            <p id={helperId} className="mt-1.5 text-xs text-muted-foreground">
              Choose a person before saving assignment.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--royal-gold)] px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-[color:var(--royal-gold-dark)] ${selectedUserId ? "" : "cursor-not-allowed opacity-50"}`}
            onClick={handleSave}
            disabled={!selectedUserId || saving}
            aria-describedby={!selectedUserId ? helperId : undefined}
          >
            {saving ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Assigning user...
              </>
            ) : (
              "Save Assignment"
            )}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-[color:var(--royal-gold)] hover:bg-muted"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
