"use client";

import { Loader2, Undo2, X } from "lucide-react";
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
import { useAppDispatch } from "@/lib/store/hooks";
import { resolveComplianceDocument } from "@/lib/store/slices/projectsSlice";

type ComplianceRejectModalProps = {
  projectId: string;
  documentId: string;
  documentLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Sends one checklist item back, with the reason that says why.
 *
 * The reason is the whole point of the dialog. It is mandatory server-side, it
 * is what the row shows the person who has to redo the work, and it is quoted
 * back to the certifier on the email that follows the replacement — so it is
 * collected in a textarea that can hold a sentence, rather than the
 * `window.prompt` this replaces. That prompt was a single unstyled line with no
 * room to read what was already typed, it blocked the whole browser tab, and on
 * a phone it is a system alert with the page frozen behind it.
 */
export function ComplianceRejectModal({
  projectId,
  documentId,
  documentLabel,
  open,
  onOpenChange,
}: ComplianceRejectModalProps) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState("");
  const [isSending, setIsSending] = useState(false);

  const close = () => {
    setReason("");
    onOpenChange(false);
  };

  const handleReject = async () => {
    const rejectionReason = reason.trim();
    if (!rejectionReason) return;

    setIsSending(true);
    try {
      await dispatch(
        resolveComplianceDocument({
          projectId,
          documentId,
          decision: "rejected",
          rejectionReason,
        }),
      ).unwrap();
      toast.success("Sent back for another go.");
      close();
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not send the document back.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-5 text-destructive-ink" aria-hidden="true" />
            Send back {documentLabel}
          </DialogTitle>
          <DialogDescription>
            The row goes back to outstanding with this note on it. Whoever
            uploads the replacement sees the note, and the certifier is told
            what was fixed as soon as it lands.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="compliance-rejection-reason">
            What needs changing?
          </Label>
          <Textarea
            id="compliance-rejection-reason"
            autoFocus
            rows={4}
            value={reason}
            disabled={isSending}
            placeholder="The certificate is out of date — it expired in March."
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSending}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            // A reason is mandatory server-side, so an empty one is refused
            // here rather than sent off to come back as a validation error.
            disabled={isSending || !reason.trim()}
            onClick={() => void handleReject()}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-4" aria-hidden="true" />
            )}
            Send it back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
