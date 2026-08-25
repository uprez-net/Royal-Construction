"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, MessageSquareText, XCircle } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { Lead } from "@/lib/leads/types";
import { fetchLead, updateLead } from "@/lib/leads/leads-service";
import {
  completeTask,
  createTask,
  fetchOpenTasks,
} from "@/lib/leads/task-service";
import { sydneyStartOfDay } from "@/lib/dates/sydney";
import { useAppDispatch } from "@/lib/store/hooks";
import { bumpLeadTasks } from "@/lib/store/slices/uiSlice";
import {
  buildFollowupCompletedHistoryEntry,
  buildFollowupNotRequiredHistoryEntry,
  buildFollowupRescheduledHistoryEntry,
} from "@/lib/leads/lead-helpers";

interface FollowupPromptModalProps {
  leadId: number;
  /** Scope the outcome to one task. Omitted means every open follow-up. */
  taskId?: number;
  onClose: () => void;
}

export function FollowupPromptModal({
  leadId,
  taskId,
  onClose,
}: FollowupPromptModalProps) {
  const dispatch = useAppDispatch();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  const [choice, setChoice] = useState<
    "yes" | "reschedule" | "notRequired" | null
  >(null);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
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
      // Rescheduling closes the current task and opens the next one, which is
      // what "reschedule" has always meant. It used to move Lead.followupDate,
      // and nothing reads that any more: the tab and both reminder crons are on
      // LeadTask, so a rescheduled follow-up disappeared.
      //
      // Answering closes the task and opens nothing.
      // Scoped to the clicked task when one was named. Without taskId this
      // came from a notification and means "this lead's open follow-ups".
      // Meetings are excluded either way: closing them would cancel a booked
      // meeting this dialog never mentions.
      const open = (await fetchOpenTasks()).filter(
        (t) =>
          t.leadId === lead.id &&
          t.type !== "MEETING" &&
          (taskId === undefined || t.id === taskId),
      );
      for (const task of open) {
        await completeTask(task.id);
      }
      if (choice === "reschedule") {
        await createTask({
          leadId: lead.id,
          type: "CALL",
          dueDate: sydneyStartOfDay(date).toISOString(),
          dueTime: time || null,
          notes: note || null,
        });
      }

      const updated = await updateLead(lead.id, {
        // No stage. Answering a follow-up used to write CONTACTED through this
        // path, which is how a lead in negotiation lost its progress to a
        // calendar action.
        history:
          choice === "reschedule"
            ? [buildFollowupRescheduledHistoryEntry(date, time, note)]
            : choice === "notRequired"
              ? [buildFollowupNotRequiredHistoryEntry(note)]
              : [buildFollowupCompletedHistoryEntry(note)],
      });

      if (updated) {
        // The tab's list is client state; router.refresh() cannot touch it.
        // Without this the row stayed on screen until a manual reload, even
        // though the task really had been closed.
        dispatch(bumpLeadTasks());
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
      maxWidthClass="max-w-[560px]"
    >
      {loading || !lead ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading lead...
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Was the follow-up completed?</Label>

            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                type="button"
                variant={choice === "yes" ? "default" : "outline"}
                className="justify-start rounded-md"
                onClick={() => setChoice("yes")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Completed
              </Button>

              <Button
                type="button"
                variant={choice === "reschedule" ? "default" : "outline"}
                className="justify-start rounded-md"
                onClick={() => setChoice("reschedule")}
              >
                <Clock3 className="mr-2 h-4 w-4" />
                Reschedule
              </Button>

              <Button
                type="button"
                variant={choice === "notRequired" ? "default" : "outline"}
                className="justify-start rounded-md"
                onClick={() => setChoice("notRequired")}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Not Required
              </Button>
            </div>
          </div>

          {choice === "reschedule" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date</Label>

                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Time</Label>

                <Input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" />
              Notes
            </Label>

            <Textarea
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                choice === "yes"
                  ? "Add any notes about the completed follow-up..."
                  : choice === "reschedule"
                    ? "Why is the follow-up being rescheduled?"
                    : choice === "notRequired"
                      ? "Why is a follow-up no longer required?"
                      : "Add an optional note..."
              }
            />
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={!choice || saving || (choice === "reschedule" && !date)}
            >
              {saving ? "Saving..." : "Save Update"}
            </Button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
