"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ExtraAttachmentsField,
  extraAttachmentIds,
  type ExtraAttachment,
} from "@/components/modals/compliance/extra-attachments-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { VaultAttachmentOption } from "@/types/compliance";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  resolveClientMeeting,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";
import { dataTimeFormat } from "@/utils/formatters";

/**
 * What became of the client and architect meeting.
 *
 * Two outcomes, and they are not variations on one thing. "It took place" is
 * the event the whole preliminary-plans clock hangs off — nothing downstream
 * can be measured until somebody says it happened. "It moved" writes a new
 * booking and mails both sides again, and leaves the old one on the file as
 * history rather than editing it away, so a set of plans that is late against
 * a meeting rescheduled twice reads as exactly that.
 *
 * The held branch offers a date because a meeting held a week after it was
 * booked is common and the clock has to run from the day they actually sat
 * down — defaulting to the booking would take that week off the architect.
 */

type Outcome = "held" | "rescheduled";

export function ResolveMeetingModal({
  projectId,
  scheduledFor,
  vaultOptions,
  open,
  onOpenChange,
}: {
  projectId: string;
  /**
   * What is on the file already, for the attach control's "From the file"
   * picker. Resolved by the caller with `vaultAttachmentOptions`.
   */
  vaultOptions?: readonly VaultAttachmentOption[];
  /** The booked time, so the dialog can say which meeting this is about. */
  scheduledFor: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.meeting),
  );
  const isPending = mutation.status === "pending";

  const [outcome, setOutcome] = useState<Outcome>("held");
  const [heldAt, setHeldAt] = useState("");
  const [newTime, setNewTime] = useState("");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);
  /**
   * Whether one of those attachments is still transferring.
   *
   * Reported by the control rather than inferred here, and part of the
   * submit gate: pressing Send mid-upload sent the ids that had landed and
   * left the rest behind, with a success toast on top of it.
   */
  const [isAttaching, setIsAttaching] = useState(false);

  const booked = new Date(scheduledFor);

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await dispatch(
        resolveClientMeeting({
          projectId,
          ...(outcome === "held"
            ? {
                outcome: "held" as const,
                // Omitted rather than defaulted here. The server falls back to
                // the booked time, and sending a value the admin did not type
                // would put a date on the record that nobody stated.
                heldAt: heldAt
                  ? new Date(heldAt).toISOString()
                  : undefined,
                note: note.trim() || undefined,
              }
            : {
                outcome: "rescheduled" as const,
                scheduledFor: new Date(newTime).toISOString(),
                note: note.trim() || undefined,
                extraAttachmentIds: extraAttachmentIds(extras),
              }),
        }),
      ).unwrap();
      toast.success(
        outcome === "held"
          ? "Recorded. We will chase the architect if the plans do not follow."
          : "Moved — both sides have the new time.",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the meeting.",
      );
    }
  };

  const canSubmit =
    !isPending && !isAttaching && (outcome === "held" || Boolean(newTime));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Meeting resolution</DialogTitle>
            <DialogDescription>
              Booked for {dataTimeFormat.format(booked)}. What happened?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <RadioGroup
              value={outcome}
              onValueChange={(value) => setOutcome(value as Outcome)}
              disabled={isPending}
              className="gap-3"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
                <RadioGroupItem value="held" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    The meeting took place
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    We start counting from here for the preliminary plans.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
                <RadioGroupItem value="rescheduled" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    The meeting was rescheduled
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Both sides get a fresh invitation with the new time.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {outcome === "held" ? (
              <div className="space-y-2">
                <Label htmlFor="meeting-held-at">
                  When it actually happened{" "}
                  <span className="font-normal text-muted-foreground">
                    (only if it was not the booked time)
                  </span>
                </Label>
                <Input
                  id="meeting-held-at"
                  type="datetime-local"
                  value={heldAt}
                  onChange={(event) => setHeldAt(event.target.value)}
                  disabled={isPending}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="meeting-new-time">New date and time</Label>
                <Input
                  id="meeting-new-time"
                  type="datetime-local"
                  value={newTime}
                  onChange={(event) => setNewTime(event.target.value)}
                  disabled={isPending}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="meeting-resolution-note">
                {outcome === "held" ? "Anything worth noting" : "Why it moved"}
              </Label>
              <Textarea
                id="meeting-resolution-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  outcome === "held"
                    ? "Optional — kept on the file."
                    : "Optional — goes into the new invitation."
                }
                disabled={isPending}
              />
            </div>
          </div>

          {/* Only on the reschedule, because only the reschedule sends
              anything. Recording a meeting as held is a note to ourselves about
              something that already happened, and there is nobody to attach a
              file to. */}
          {outcome === "rescheduled" ? (
            <ExtraAttachmentsField
              onUploadingChange={setIsAttaching}
              projectId={projectId}
              value={extras}
              onChange={setExtras}
              vaultOptions={vaultOptions}
              disabled={isPending}
              hint="Anything the new invitation should carry — both the client and the architect receive it."
            />
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {outcome === "held" ? "Record it" : "Send the new time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
