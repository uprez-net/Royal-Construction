"use client";

import { ComplianceExternalApplicationKind } from "@prisma/client";
import { Loader2, Send } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EXTERNAL_APPLICATION_COPY } from "@/constants/complianceDocuments";
import { useAppDispatch } from "@/lib/store/hooks";
import { recordExternalApplication } from "@/lib/store/slices/projectsSlice";

type ResubmitApplicationModalProps = {
  projectId: string;
  kind: ComplianceExternalApplicationKind;
  /** The round this will be, for the heading. */
  nextRound: number;
  /** Carried forward into the field, because it is usually unchanged. */
  applicationRef?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Records that an application went back in after being sent back.
 *
 * The lodgement itself happens outside this system entirely — somebody uploads
 * the revised pack to the portal — and what is tracked here is the date, the
 * reference and what the round carried. That is everything needed to chase it
 * by phone and everything the overdue clock reads.
 *
 * Its own dialog rather than a second "record a lodgement" on the block,
 * because the two mean different things and conflating them loses the only
 * thing anybody wants to know afterwards. Recording a resubmission as a
 * lodgement overwrites the original date, and the file then says an application
 * that took four rounds and five months went in once, in April.
 *
 * The date defaults to today, which is right almost every time: this is
 * recorded within minutes of the upload, by the person who did it.
 */
export function ResubmitApplicationModal({
  projectId,
  kind,
  nextRound,
  applicationRef,
  open,
  onOpenChange,
}: ResubmitApplicationModalProps) {
  const dispatch = useAppDispatch();
  const copy = EXTERNAL_APPLICATION_COPY[kind];

  const [submittedAt, setSubmittedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reference, setReference] = useState(applicationRef ?? "");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setNote("");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!submittedAt) return;

    setIsSaving(true);
    try {
      await dispatch(
        recordExternalApplication({
          projectId,
          step: "resubmitted",
          kind,
          submittedAt: new Date(submittedAt).toISOString(),
          applicationRef: reference.trim() || undefined,
          note: note.trim() || undefined,
        }),
      ).unwrap();
      toast.success(`Round ${nextRound} recorded.`);
      close();
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not record the resubmission.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Record round {nextRound} of the {copy.label.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            Lodging it happens on the portal. This records that it went back in,
            so the clock runs from today rather than from the first lodgement —
            and so the file remembers how many rounds this took.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="resubmit-date">When did it go back in?</Label>
            <Input
              id="resubmit-date"
              type="date"
              value={submittedAt}
              disabled={isSaving}
              onChange={(event) => setSubmittedAt(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resubmit-ref">Application number</Label>
            <Input
              id="resubmit-ref"
              value={reference}
              disabled={isSaving}
              placeholder="DA-2026/0412"
              onChange={(event) => setReference(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Usually the same as last time. Change it only if the council
              issued a new one.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resubmit-note">What did this round carry?</Label>
            <Textarea
              id="resubmit-note"
              rows={3}
              value={note}
              disabled={isSaving}
              placeholder="Revised drawings A03 and A04, shadow diagram added."
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

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
            disabled={isSaving || !submittedAt}
            onClick={() => void handleSubmit()}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
