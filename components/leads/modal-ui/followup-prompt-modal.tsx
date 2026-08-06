"use client";

import { useEffect, useMemo, useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { fetchLead, updateLead } from "@/lib/leads/leads-service";
import { useRouter } from "next/navigation";
import {
  buildFollowupNotRequiredHistoryEntry,
  buildFollowupRescheduledHistoryEntry,
} from "@/lib/leads/lead-helpers";

interface FollowupPromptModalProps {
  leadId: number;
  onClose: () => void;
}

export function FollowupPromptModal({
  leadId,
  onClose,
}: FollowupPromptModalProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<
    "yes" | "reschedule" | "notRequired" | null
  >(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const timeout = setTimeout(() => {
      setLoading(true);

      fetchLead(leadId)
        .then((result) => {
          if (!cancelled) {
            setLead(result);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [leadId]);

  const title = useMemo(
    () => (lead ? `Follow-up for ${lead.name}` : "Follow-up Response"),
    [lead],
  );

  const handleSubmit = async () => {
    if (!lead || !choice) return;
    if (choice === "reschedule" && !date) return;

    setSaving(true);
    try {
      const updated = await updateLead(lead.id, {
        followupDate: choice === "reschedule" ? date : null,
        followupTime: choice === "reschedule" ? time : null,
        stage: choice === "reschedule" ? "In Follow-up" : lead.stage,
        history:
          choice === "reschedule"
            ? [buildFollowupRescheduledHistoryEntry(date, time)]
            : choice === "notRequired"
              ? [buildFollowupNotRequiredHistoryEntry()]
              : [],
      });

      if (updated) {
        router.refresh();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      title={title}
      subtitle={lead ? `Lead #${lead.id}` : undefined}
      maxWidthClass="max-w-[520px]"
    >
      {loading || !lead ? (
        <div className="text-sm text-muted-foreground">Loading lead...</div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">
            Was the follow-up completed?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full border px-4 py-2 text-sm ${choice === "yes" ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
              onClick={() => setChoice("yes")}
            >
              Yes
            </button>
            <button
              type="button"
              className={`rounded-full border px-4 py-2 text-sm ${choice === "reschedule" ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
              onClick={() => setChoice("reschedule")}
            >
              Reschedule
            </button>
            <button
              type="button"
              className={`rounded-full border px-4 py-2 text-sm ${choice === "notRequired" ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
              onClick={() => setChoice("notRequired")}
            >
              Not Required
            </button>
          </div>

          {choice === "reschedule" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Date
                </label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Time
                </label>
                <input
                  type="time"
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-royal-gold px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              onClick={handleSubmit}
              disabled={!choice || saving || (choice === "reschedule" && !date)}
            >
              {saving ? "Saving..." : "Submit"}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
