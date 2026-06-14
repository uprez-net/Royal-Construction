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
    "mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]";

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
          <label className="text-xs font-medium text-[#78716c]">Date</label>
          <input
            type="date"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[#78716c]">Time</label>
          <input
            type="time"
            className={inputCls}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] ${date ? "" : "cursor-not-allowed opacity-50"}`}
            onClick={handleSave}
            disabled={!date || saving}
          >
            {saving ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Updating Follow-up ...
              </>
            ) : (
              "Save Follow-up"
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
