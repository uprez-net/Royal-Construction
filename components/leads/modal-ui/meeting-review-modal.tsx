"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Globe,
  Laptop,
  MessageSquareText,
  MonitorSmartphone,
  StickyNote,
  XCircle,
} from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Lead } from "@/lib/leads/types";
import { fetchLead, updateLead } from "@/lib/leads/leads-service";
import {
  buildMeetingDidNotTakePlaceHistoryEntry,
  buildMeetingReviewedHistoryEntry,
} from "@/lib/leads/lead-helpers";

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
              history: [buildMeetingDidNotTakePlaceHistoryEntry(discussionNotes)],
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
      title={lead ? `Meeting review for ${lead.name}` : "Meeting Review"}
      subtitle={lead ? `Lead #${lead.id}` : undefined}
      maxWidthClass="max-w-[560px]"
    >
      {loading || !lead ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading meeting...
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Did the meeting take place?</Label>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={tookPlace === true ? "default" : "outline"}
                className="justify-start rounded-md"
                onClick={() => setTookPlace(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Yes, Completed
              </Button>

              <Button
                type="button"
                variant={tookPlace === false ? "default" : "outline"}
                className="justify-start rounded-md"
                onClick={() => setTookPlace(false)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                No, Didn't Happen
              </Button>
            </div>
          </div>

          {tookPlace === true && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Meeting Mode
                </Label>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={meetingMode === "Online" ? "default" : "outline"}
                    className="justify-start rounded-md"
                    onClick={() => setMeetingMode("Online")}
                  >
                    <MonitorSmartphone className="mr-2 h-4 w-4" />
                    Online
                  </Button>

                  <Button
                    type="button"
                    variant={meetingMode === "Offline" ? "default" : "outline"}
                    className="justify-start rounded-md"
                    onClick={() => setMeetingMode("Offline")}
                  >
                    <Laptop className="mr-2 h-4 w-4" />
                    Offline
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4" />
                  Discussion Notes
                </Label>

                <Textarea
                  rows={4}
                  value={discussionNotes}
                  onChange={(event) => setDiscussionNotes(event.target.value)}
                  placeholder="Summarise what was discussed during the meeting..."
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4" />
                  Build Scope
                </Label>

                <Textarea
                  rows={4}
                  value={buildScope}
                  onChange={(event) => setBuildScope(event.target.value)}
                  placeholder="Describe the requested work, features, budget or scope..."
                />
              </div>
            </>
          )}

          {tookPlace === false && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4" />
                Reason (Optional)
              </Label>

              <Textarea
                rows={4}
                value={discussionNotes}
                onChange={(event) => setDiscussionNotes(event.target.value)}
                placeholder="Why didn't the meeting take place?"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={tookPlace === null || saving}
            >
              {saving ? "Saving..." : "Save Review"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
