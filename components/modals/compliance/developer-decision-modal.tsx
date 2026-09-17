"use client";

import {
  ComplianceApprovalDecision,
  ComplianceDocumentType,
} from "@prisma/client";
import { Check, Loader2, Undo2 } from "lucide-react";
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
import {
  complianceDocumentLabel,
  type DeveloperApprovalDocument,
} from "@/constants/complianceDocuments";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch } from "@/lib/store/hooks";
import { recordDeveloperDecision } from "@/lib/store/slices/projectsSlice";

type DeveloperDecisionModalProps = {
  projectId: string;
  /**
   * Which document they are answering about.
   *
   * Optional, and defaulted to the bushfire report. The covenant covers the
   * architectural design too, and the dialog names whichever it was opened for —
   * a confirmation that says "the report" over a verdict about the drawings is
   * the one place this dialog could mislead somebody into an irreversible click.
   */
  documentType?: DeveloperApprovalDocument;
  decision: ComplianceApprovalDecision;
  /** The estate, for the heading. Blank on a row whose list entry has gone. */
  estate?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Records the estate developer's answer on one document under covenant.
 *
 * One dialog for both verdicts rather than a modal for the refusal and a bare
 * button for the approval, because they are the same act — a person has read
 * the developer's reply and is telling the file what it said — and because an
 * approval that goes through with no confirmation at all is the one click here
 * nobody can undo from the screen. It opens a covenant gate.
 *
 * The reasons are the whole point of the rejection branch. They are mandatory
 * server-side, they are quoted verbatim into the mail that goes to the bushfire
 * consultant within the same request, and that mail is the only thing telling
 * somebody what to change. "Not approved" costs another eleven working days.
 *
 * The approval branch takes no input at all and says so plainly, which is why
 * it is worth the dialog: what the reader needs before pressing it is to be
 * told what happens next, not another field.
 */
export function DeveloperDecisionModal({
  projectId,
  documentType = ComplianceDocumentType.BUSHFIRE_REPORT,
  decision,
  estate,
  open,
  onOpenChange,
}: DeveloperDecisionModalProps) {
  const dispatch = useAppDispatch();
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isRejecting = decision === ComplianceApprovalDecision.REJECTED;
  const who = estate?.trim() || "the estate developer";
  const what = complianceDocumentLabel(documentType).toLowerCase();

  const close = () => {
    setReason("");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (isRejecting && !trimmed) return;

    setIsSaving(true);
    try {
      await dispatch(
        recordDeveloperDecision({
          projectId,
          documentType,
          decision,
          reason: isRejecting ? trimmed : undefined,
        }),
      ).unwrap();
      toast.success(
        isRejecting
          ? `Recorded, and sent on to whoever produced the ${what}.`
          : "Developer approval recorded.",
      );
      close();
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not record the decision.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRejecting ? (
              <Undo2
                className="size-5 text-destructive-ink"
                aria-hidden="true"
              />
            ) : (
              <Check className="size-5 text-primary" aria-hidden="true" />
            )}
            {isRejecting
              ? "Record a rejection"
              : "Record the developer's approval"}
          </DialogTitle>
          <DialogDescription>
            {isRejecting
              ? `What ${who} said goes straight to whoever produced the ${what}, on their own thread, word for word and with the document attached. The file then waits on a revised version.`
              : `This records that ${who} has approved the ${what}. It is one of the things holding the lodgement shut, so the pack becomes lodgeable once every other row is answered.`}
          </DialogDescription>
        </DialogHeader>

        {isRejecting ? (
          <div className="space-y-2">
            <Label htmlFor="developer-rejection-reason">
              What did they say has to change?
            </Label>
            <Textarea
              id="developer-rejection-reason"
              autoFocus
              rows={4}
              value={reason}
              disabled={isSaving}
              // A real example rather than a shape. The reason has to be
              // actionable by somebody who was not on the thread, and a
              // placeholder reading "Enter reason" invites "not approved".
              placeholder="Quote them — e.g. “The roof material specified does not meet the BAL-29 requirement in the estate covenant. Clause 4.2 requires non-combustible.”"
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Their words, not a summary. Whoever redoes the {what} has only
              this to work from.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={isRejecting ? "destructive" : "default"}
            // A reason is mandatory server-side, so an empty one is refused
            // here rather than sent off to come back as a validation error.
            disabled={isSaving || (isRejecting && !reason.trim())}
            onClick={() => void handleSubmit()}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : isRejecting ? (
              <Undo2 className="size-4" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {isRejecting ? "Record and send it on" : "Record the approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
