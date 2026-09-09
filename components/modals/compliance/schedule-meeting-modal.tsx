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
import { Textarea } from "@/components/ui/textarea";
import type { VaultAttachmentOption } from "@/types/compliance";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  scheduleClientMeeting,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";

/**
 * Books the client and the architect in.
 *
 * A date and a time and nothing else, because everything else the invitation
 * needs is already on the file: who the architect is, who the client is, which
 * site it is about, and why they are meeting. Asking for any of that again
 * would be asking somebody to retype what is on screen behind the dialog.
 *
 * The one optional field is the note, which is the only thing this dialog can
 * learn that the file does not already know.
 */
export function ScheduleMeetingModal({
  projectId,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.meeting),
  );
  const isPending = mutation.status === "pending";

  const [scheduledFor, setScheduledFor] = useState("");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduledFor) return;

    try {
      await dispatch(
        scheduleClientMeeting({
          projectId,
          // A `datetime-local` value has no zone on it, and the browser is on
          // the same clock as the site. Reading it as local and sending the
          // instant is what makes "10am" mean 10am to everyone the invitation
          // reaches.
          scheduledFor: new Date(scheduledFor).toISOString(),
          note: note.trim() || undefined,
          extraAttachmentIds: extraAttachmentIds(extras),
        }),
      ).unwrap();
      toast.success("Invitation sent to the client and the architect.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not schedule the meeting.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Schedule a meeting with the client</DialogTitle>
            <DialogDescription>
              Both the client and the architect are emailed the time on the
              architect&apos;s thread. The point of the meeting is to go through
              what the owners want before anything is drawn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-scheduled-for">Date and time</Label>
              <Input
                id="meeting-scheduled-for"
                type="datetime-local"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
                disabled={isPending}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="meeting-note">Anything to add</Label>
              <Textarea
                id="meeting-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional — goes into the invitation as its own line."
                disabled={isPending}
              />
            </div>
          </div>

          <ExtraAttachmentsField
            projectId={projectId}
            value={extras}
            onChange={setExtras}
            vaultOptions={vaultOptions}
            disabled={isPending}
            hint="Both the client and the architect receive this, so it is the one place an agenda or the client's own sketches reach them together."
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !scheduledFor}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
