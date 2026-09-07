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
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  resolveComplianceAlert,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";

type ResolveAlertModalProps = {
  projectId: string;
  alertId: string;
  alertTitle: string;
  /** What closing this one actually requires, in the flow's own terms. */
  guidance: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Closes a compliance alert.
 *
 * A dialog rather than a button, for the reason rejecting a document is one:
 * the act has to carry why. These two alerts are closed by a judgement rather
 * than by an event — somebody looked at the replacement title search and
 * decided it names the right owners — and "resolved" on its own tells the next
 * person nothing about whether that actually happened.
 */
export function ResolveAlertModal({
  projectId,
  alertId,
  alertTitle,
  guidance,
  open,
  onOpenChange,
}: ResolveAlertModalProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.alert(alertId)),
  );
  const isPending = mutation.status === "pending";
  const [note, setNote] = useState("");

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim()) return;

    try {
      await dispatch(
        resolveComplianceAlert({
          projectId,
          alertId,
          resolutionNote: note.trim(),
        }),
      ).unwrap();
      toast.success("Alert closed.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not close the alert.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{alertTitle}</DialogTitle>
            <DialogDescription>{guidance}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="alert-resolution">What resolved it</Label>
            <Textarea
              id="alert-resolution"
              rows={3}
              required
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Replacement title search received and checked against the current owners."
              disabled={isPending}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !note.trim()}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Close alert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
