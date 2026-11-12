"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reopenChecklistAction } from "@/lib/data/checklist-actions";

import { RefusalAlert } from "./checklist-reviewer-fields";

/** A required or optional note: reopening, sending back, a comment. */
function NoteDialogBody({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  required,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  required: boolean;
  /** Answers the refusal to show, or null when it worked. */
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (required && !note.trim()) return setError(`${label} is required.`);
    setPending(true);
    const refusal = await onSubmit(note.trim()).catch(
      () => "That did not save. Try again.",
    );
    setPending(false);
    if (refusal) return setError(refusal);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="note-dialog-text">
            {label}
            {required ? "" : " (optional)"}
          </Label>
          <Textarea
            id="note-dialog-text"
            value={note}
            maxLength={2000}
            rows={3}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <RefusalAlert message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenChecklistDialog({
  open,
  onOpenChange,
  projectId,
  checklistId,
  title,
  onReopened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  checklistId: string;
  title: string;
  onReopened: () => void;
}) {
  return (
    <NoteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Reopen ${title}`}
      description="Reopening takes back the sign-off so the checklist can be edited. The reason is kept in the project history."
      label="Reason"
      confirmLabel="Reopen checklist"
      required
      onSubmit={async (reason) => {
        const result = await reopenChecklistAction({
          checklistId,
          projectId,
          reason,
        });
        if (!result.ok) return result.error;
        toast.success(`${title} reopened.`);
        onReopened();
        return null;
      }}
    />
  );
}

export function NoteDialog(props: Parameters<typeof NoteDialogBody>[0]) {
  return props.open ? <NoteDialogBody {...props} /> : null;
}
