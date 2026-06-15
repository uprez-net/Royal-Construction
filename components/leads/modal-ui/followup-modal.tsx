import React, { useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { updateLead } from "@/lib/leads/leads-service";
import {
  createCalendarEventIfValid,
  buildCalendarHistoryEntry,
} from "@/lib/leads/lead-helpers";

interface FollowupModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdate: (lead: Lead) => void;
  showToast: (msg: string, type?: "success" | "info" | "error") => void;
}

export function FollowupModal({
  lead,
  onClose,
  onLeadUpdate,
  showToast,
}: FollowupModalProps) {
  const [date, setDate] = useState(lead.followupDate || "");
  const [time, setTime] = useState(lead.followupTime || "");
  const [saving, setSaving] = useState(false);
  const formId = React.useId();
  const dateId = `${formId}-date`;
  const timeId = `${formId}-time`;
  const dateHelperId = `${dateId}-helper`;

  const handleSave = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const tempLead = { ...lead, followupDate: date, followupTime: time };
      const success = await createCalendarEventIfValid(tempLead, showToast);
      if (!success) {
        showToast("Calendar event could not be created", "error");
        return;
      }

      const updated = await updateLead(lead.id, {
        followupDate: date,
        followupTime: time,
        history: [buildCalendarHistoryEntry(date, time)],
        stage: "In Follow-up",
      });

      if (!updated) {
        showToast("Failed to update lead", "error");
        return;
      }
      onLeadUpdate(updated);
      showToast(`Updated follow-up for ${updated.name}`, "success");
      onClose();
    } catch (error) {
      console.error("Failed to update follow-up", error);
      showToast("Failed to update follow-up", "error");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-[4px] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-[color:var(--royal-gold)] focus:outline-none focus:ring-2 focus:ring-[color:var(--royal-gold-light)]";
  const labelCls = "text-xs font-medium text-muted-foreground";

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Set Follow-up"
      subtitle={`For ${lead.name}`}
      maxWidthClass="max-w-[400px]"
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor={dateId}
            className={labelCls}
          >
            Date
          </label>
          <input
            id={dateId}
            type="date"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            aria-describedby={!date ? dateHelperId : undefined}
          />
          {!date && (
            <p id={dateHelperId} className="mt-1.5 text-xs text-muted-foreground">
              Choose a follow-up date before saving.
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={timeId}
            className={labelCls}
          >
            Time
          </label>
          <input
            id={timeId}
            type="time"
            className={inputCls}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--royal-gold)] px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-[color:var(--royal-gold-dark)] ${date ? "" : "cursor-not-allowed opacity-50"}`}
            onClick={handleSave}
            disabled={!date || saving}
            aria-describedby={!date ? dateHelperId : undefined}
          >
            {saving ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Updating follow-up...
              </>
            ) : (
              "Save Follow-up"
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
