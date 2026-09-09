"use client";

import { CompliancePartyType } from "@prisma/client";
import { Loader2, Paperclip, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { VaultAttachmentOption } from "@/types/compliance";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  requestWasteManagementPlan,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";

type WasteManagementModalProps = {
  projectId: string;
  /** Who it is going to, for the line that says so. */
  contactName: string | null;
  contactEmail: string | null;
  /**
   * What the send will attach, resolved by the caller off the document rows.
   *
   * Shown rather than chosen, exactly as the party outreach lists its own: the
   * architect is being asked to draw against the design they produced, and a
   * set of checkboxes here would be an invitation to send them the wrong one.
   */
  attachments: { name: string; url: string }[];
  /** The checklist line this answers, where it came off one. */
  checklistDocumentId?: string;
  /**
   * What is on the file already, for the attach control's "From the file"
   * picker. Resolved by the caller with `vaultAttachmentOptions`.
   */
  vaultOptions?: readonly VaultAttachmentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Asks the architect for the waste management plan.
 *
 * Deliberately not the connect modal. Every other document on this file that
 * needs somebody outside starts with picking a firm; this one does not, because
 * the architect who drew the plans is already on the file with a thread and an
 * address, and the plan is drawn against their own design. A contact picker
 * here would be an invitation to send the request to a stranger who would then
 * need the whole set explained to them.
 *
 * So what is left is a note and a send — which is why this is a small dialog
 * rather than a form, and why the only thing it collects is the sentence that
 * differs between one job and the next.
 */
export function WasteManagementModal({
  projectId,
  contactName,
  contactEmail,
  attachments,
  checklistDocumentId,
  vaultOptions,
  open,
  onOpenChange,
}: WasteManagementModalProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(
      complianceScope.party(CompliancePartyType.ARCHITECT),
    ),
  );
  const isPending = mutation.status === "pending";
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);

  const recipient = contactName ?? contactEmail ?? "the architect";

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await dispatch(
        requestWasteManagementPlan({
          projectId,
          note: note.trim() || undefined,
          checklistDocumentId,
          extraAttachmentIds: extraAttachmentIds(extras),
        }),
      ).unwrap();
      toast.success("Request sent to the architect.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the request.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Ask for the waste management plan</DialogTitle>
            <DialogDescription>
              This goes to {recipient} on the architect thread already open on
              this job, with the current drawings attached. Their reply is
              matched back by the reference in the subject line.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Attached to this request</Label>
              {attachments.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-border/70 bg-muted/40 p-2">
                  {attachments.map((attachment) => (
                    <li
                      key={attachment.url}
                      className="flex items-center gap-2 px-1 py-0.5 text-sm"
                    >
                      <Paperclip
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate">{attachment.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                // Not a blocker. An architect can write a waste management plan
                // off the set they already hold, and holding the request until
                // a copy of their own drawings is on our file would stall a
                // development application over a formality.
                <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-light px-3 py-2 text-xs text-foreground">
                  <X className="size-3.5 shrink-0" aria-hidden="true" />
                  No drawings on the file to send — they will be working from
                  their own copy.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="waste-management-note">Anything to add</Label>
              <Textarea
                id="waste-management-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional — goes into the email as its own line."
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
            hint="The certifier's own wording on the line that asked for it, most usefully — it saves the architect being told second-hand what this council wants."
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
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
