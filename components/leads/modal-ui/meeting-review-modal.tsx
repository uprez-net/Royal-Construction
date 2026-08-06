"use client";

import { useEffect, useState } from "react";
import { ModalShell } from "@/components/common/modal-shell";
import { Lead } from "@/lib/leads/types";
import { fetchLead, updateLead } from "@/lib/leads/leads-service";
import {
  buildMeetingDidNotTakePlaceHistoryEntry,
  buildMeetingReviewedHistoryEntry,
} from "@/lib/leads/lead-helpers";
import { useRouter } from "next/navigation";

interface MeetingReviewModalProps {
  leadId: number;
  onClose: () => void;
}

export function MeetingReviewModal({
  leadId,
  onClose,
}: MeetingReviewModalProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [tookPlace, setTookPlace] = useState<boolean | null>(null);
  const [meetingMode, setMeetingMode] = useState<"Online" | "Offline">(
    "Online",
  );
  const [discussionNotes, setDiscussionNotes] = useState("");
  const [buildScope, setBuildScope] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const timeout = setTimeout(() => {
      setLoading(true);

      fetchLead(leadId)
        .then((result) => {
          if (!cancelled) setLead(result);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [leadId]);

  const handleSubmit = async () => {
    if (!lead || tookPlace === null) return;
    setSaving(true);
    try {
      const updated = await updateLead(
        lead.id,
        tookPlace
          ? {
              meetingMode,
              history: [
                buildMeetingReviewedHistoryEntry({
                  meetingMode,
                  discussionNotes,
                  buildScope,
                }),
              ],
            }
          : {
              history: [buildMeetingDidNotTakePlaceHistoryEntry()],
            },
      );

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
      title={lead ? `Meeting review for ${lead.name}` : "Meeting review"}
      maxWidthClass="max-w-[560px]"
    >
      {loading || !lead ? (
        <div className="text-sm text-muted-foreground">Loading lead...</div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">
            Did the meeting take place?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full border px-4 py-2 text-sm ${tookPlace === true ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
              onClick={() => setTookPlace(true)}
            >
              Yes
            </button>
            <button
              type="button"
              className={`rounded-full border px-4 py-2 text-sm ${tookPlace === false ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
              onClick={() => setTookPlace(false)}
            >
              No
            </button>
          </div>

          {tookPlace === true && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Mode
                </label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className={`rounded-full border px-4 py-2 text-sm ${meetingMode === "Online" ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
                    onClick={() => setMeetingMode("Online")}
                  >
                    Online
                  </button>
                  <button
                    type="button"
                    className={`rounded-full border px-4 py-2 text-sm ${meetingMode === "Offline" ? "border-royal-gold bg-royal-gold-light" : "border-border"}`}
                    onClick={() => setMeetingMode("Offline")}
                  >
                    Offline
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Discussion Notes
                </label>
                <textarea
                  className="mt-1 min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={discussionNotes}
                  onChange={(event) => setDiscussionNotes(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Build Scope
                </label>
                <textarea
                  className="mt-1 min-h-24 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  value={buildScope}
                  onChange={(event) => setBuildScope(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full bg-royal-gold px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              onClick={handleSubmit}
              disabled={tookPlace === null || saving}
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
