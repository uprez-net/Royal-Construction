"use client";

import { ComplianceDocumentType } from "@prisma/client";
import { Loader2, Send } from "lucide-react";
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
import {
  complianceDocumentLabel,
  type DeveloperApprovalDocument,
} from "@/constants/complianceDocuments";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch } from "@/lib/store/hooks";
import { resendDeveloperApproval } from "@/lib/store/slices/projectsSlice";
import type { VaultAttachmentOption } from "@/types/compliance";

type DeveloperResendModalProps = {
  projectId: string;
  /**
   * Which document is going over.
   *
   * Optional and defaulted to the bushfire report, which is what this dialog sent
   * before the architectural design came under covenant. Named in the copy, because
   * the whole value of the dialog is the objection quoted in it and an objection
   * about the drawings under a heading about the report is worse than no heading.
   */
  documentType?: DeveloperApprovalDocument;
  /** What they said last time, so the sender can check it has been answered. */
  previousReason?: string | null;
  vaultOptions?: readonly VaultAttachmentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Puts one document under covenant in front of the developer.
 *
 * Both the first ask and every re-ask, because they are the same message on the
 * same thread about the same document — see `resendDeveloperApproval`.
 *
 * A dialog rather than a bare button, and the reason is the block quoted at the
 * top of it. The one way this loop goes wrong is a revised document that does not
 * actually answer what the developer objected to — a consultant who addressed
 * the wrong clause, an architect who returned the same set with a new date — and
 * sending that costs a second full turnaround. So their words are put in front
 * of whoever is about to press send, next to the send.
 *
 * The document itself is not chosen here. It is whatever is on that row, resolved
 * server-side at send time, for the same reason every other outreach on this tab
 * resolves its own attachments: the mail should carry the current copy rather than
 * whichever one the client happened to be looking at.
 */
export function DeveloperResendModal({
  projectId,
  documentType = ComplianceDocumentType.BUSHFIRE_REPORT,
  previousReason,
  vaultOptions,
  open,
  onOpenChange,
}: DeveloperResendModalProps) {
  const dispatch = useAppDispatch();
  const label = complianceDocumentLabel(documentType).toLowerCase();
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
  const [isSending, setIsSending] = useState(false);

  const close = () => {
    setNote("");
    setExtras([]);
    onOpenChange(false);
  };

  const handleSend = async () => {
    setIsSending(true);
    try {
      await dispatch(
        resendDeveloperApproval({
          projectId,
          documentType,
          note: note.trim() || undefined,
          extraAttachmentIds: extraAttachmentIds(extras),
        }),
      ).unwrap();
      toast.success("Sent back to the developer.");
      close();
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
          : `Could not send the ${label} back.`,
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {previousReason
              ? `Send the ${label} back for approval`
              : `Send the ${label} for approval`}
          </DialogTitle>
          <DialogDescription>
            The {label} currently on the file goes to the developer on their own
            thread, and the file waits on their answer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {previousReason ? (
            <div className="rounded-md border border-border/70 bg-muted/40 p-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                What they said last time
              </p>
              <p className="mt-1 text-sm text-foreground">{previousReason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Check the revised {label} actually answers this before you send it
                — a second refusal is another two weeks.
              </p>
            </div>
          ) : null}

          <ExtraAttachmentsField
            onUploadingChange={setIsAttaching}
            projectId={projectId}
            value={extras}
            onChange={setExtras}
            vaultOptions={vaultOptions}
            disabled={isSending}
            hint={`The ${label} is attached automatically. Add anything else the estate asked to see.`}
          />

          <div className="space-y-2">
            <Label htmlFor="developer-resend-note">Anything to add</Label>
            <Textarea
              id="developer-resend-note"
              rows={3}
              value={note}
              disabled={isSending}
              placeholder="Optional — goes into the email as its own line."
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
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
            disabled={isSending || isAttaching}
            onClick={() => void handleSend()}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
