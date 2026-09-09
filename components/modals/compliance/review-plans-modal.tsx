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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { VaultAttachmentOption } from "@/types/compliance";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  reviewArchitectPlans,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";

/**
 * The client's verdict on the preliminary plans.
 *
 * The one decision on this tab with genuinely different consequences either
 * way. Yes opens the send to the certifier, which is the gate this exists for —
 * a pack built on plans the client has not seen is a pack that comes back,
 * because the certifier assesses a design the client then changes. No sends the
 * client's own words to the architect and starts a clock on the redraw.
 *
 * The feedback is required on a no and is sent verbatim. That is not
 * bureaucracy: it is the entire content of the mail the architect receives, and
 * a summary of it — "the client wants some changes" — is a phone call somebody
 * then has to make anyway.
 */
export function ReviewPlansModal({
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
    selectComplianceMutation(complianceScope.planReview),
  );
  const isPending = mutation.status === "pending";

  const [approved, setApproved] = useState<"yes" | "no">("yes");
  const [feedback, setFeedback] = useState("");
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const isApproved = approved === "yes";
    if (!isApproved && !feedback.trim()) return;

    try {
      await dispatch(
        reviewArchitectPlans({
          projectId,
          approved: isApproved,
          feedback: isApproved ? undefined : feedback.trim(),
          extraAttachmentIds: extraAttachmentIds(extras),
        }),
      ).unwrap();
      toast.success(
        isApproved
          ? "Recorded — the pack can go to the certifier."
          : "The revisions are with the architect.",
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record the client's answer.",
      );
    }
  };

  const canSubmit =
    !isPending && (approved === "yes" || Boolean(feedback.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Has the client approved the plans?</DialogTitle>
            <DialogDescription>
              Nothing goes to the certifier until they have. An assessment of a
              design the client is about to change is an assessment we pay for
              twice.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <RadioGroup
              value={approved}
              onValueChange={(value) => setApproved(value as "yes" | "no")}
              disabled={isPending}
              className="gap-3"
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
                <RadioGroupItem value="yes" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Yes, they are happy with them
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Opens the send to the certifier.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
                <RadioGroupItem value="no" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    No, they want changes
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Goes to the architect as a revision request.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {approved === "no" ? (
              <div className="space-y-2">
                <Label htmlFor="plan-feedback">What do they want changed?</Label>
                <Textarea
                  id="plan-feedback"
                  rows={5}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="In the client's own words — this is sent to the architect exactly as written."
                  disabled={isPending}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  We will chase the architect if a revised set has not come back
                  within about eleven working days.
                </p>
              </div>
            ) : null}
          </div>

          <ExtraAttachmentsField
            projectId={projectId}
            value={extras}
            onChange={setExtras}
            vaultOptions={vaultOptions}
            disabled={isPending}
            hint="A photograph of the marked-up printout, a sketch — anything that says what the client wants better than the words do."
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
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {approved === "yes" ? "Record approval" : "Send the revisions"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
