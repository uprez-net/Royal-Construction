"use client";

import type { CompliancePartyType } from "@prisma/client";
import { Loader2, Paperclip, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ExtraAttachmentsField,
  extraAttachmentIds,
  type ExtraAttachment,
} from "@/components/modals/compliance/extra-attachments-field";
import { LeadRichTextEditor } from "@/components/rich-text/lead-rich-text-editor";
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
import { PARTY_LABEL } from "@/constants/complianceDocuments";
import { buildPartyRevisionBody } from "@/lib/domain/compliance/party-outreach-email";
import { emailHtmlToLeadNotesDocument } from "@/lib/rich-text/lead-notes";
import type { LeadRichTextDocument } from "@/lib/leads/types";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  sendPartyReply,
} from "@/lib/store/slices/projectsSlice";
import type { VaultAttachmentOption } from "@/types/compliance";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";

type PartyRevisionModalProps = {
  projectId: string;
  outreachId: string;
  party: CompliancePartyType;
  contactName?: string | null;
  contactEmail?: string | null;
  subjectAddress: string;
  documentLabel: string;
  rejectionReason: string;
  attachments: CertifierReplyAttachment[];
  vaultOptions?: readonly VaultAttachmentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Requests a revision on the original producer's existing email thread. */
export function PartyRevisionModal({
  projectId,
  outreachId,
  party,
  contactName,
  contactEmail,
  subjectAddress,
  documentLabel,
  rejectionReason,
  attachments,
  vaultOptions,
  open,
  onOpenChange,
}: PartyRevisionModalProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.partyReply(outreachId)),
  );
  const isSending = mutation.status === "pending";
  const label = PARTY_LABEL[party];
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);
  const [isAttachingExtras, setIsAttachingExtras] = useState(false);

  const generatedBody = useMemo(
    () =>
      buildPartyRevisionBody({
        contactName: contactName ?? null,
        subjectAddress,
        documentLabel,
        rejectionReason,
      }),
    [contactName, documentLabel, rejectionReason, subjectAddress],
  );
  const [emailBody, setEmailBody] = useState<LeadRichTextDocument>(() =>
    emailHtmlToLeadNotesDocument(generatedBody),
  );

  const handleSend = async () => {
    try {
      await dispatch(
        sendPartyReply({
          projectId,
          outreachId,
          body: emailBody.html.trim(),
          bodyFormat: "html",
          attachments,
          extraAttachmentIds: extraAttachmentIds(extras),
        }),
      ).unwrap();
      toast.success(`Revision requested from the ${label.toLowerCase()}.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not send the revision request.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Request a revision from the {label}</DialogTitle>
          <DialogDescription>
            Review the certifier&apos;s feedback, edit the email, and confirm
            every attachment before sending it on the existing{" "}
            {label.toLowerCase()}
            thread.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
          <section
            className="min-w-0 flex flex-col gap-2"
            aria-labelledby="party-revision-email-label"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p
                  id="party-revision-email-label"
                  className="text-sm font-semibold text-foreground"
                >
                  Email body
                </p>
                <p className="text-xs text-muted-foreground">
                  The certifier&apos;s rejection reason is included and can be
                  edited before it is sent.
                </p>
              </div>
              <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                Editable draft
              </span>
            </div>

            <LeadRichTextEditor
              value={emailBody}
              availableUsers={[]}
              onChange={setEmailBody}
              onSaveNote={() => undefined}
              canSaveNote={false}
              isSavingNote={false}
              hideSaveButton
              hideMentionInfo
              disabled={isSending}
              placeholder="Write the revision request…"
              ariaLabelledBy="party-revision-email-label"
            />
          </section>

          <aside className="min-w-0 flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Delivery details
              </p>
              <Label htmlFor="party-revision-recipient">Recipient</Label>
              <Input
                id="party-revision-recipient"
                value={
                  contactEmail
                    ? `${contactName || label} <${contactEmail}>`
                    : contactName || label
                }
                readOnly
                disabled
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="party-revision-address">Site address</Label>
              <Input
                id="party-revision-address"
                value={subjectAddress}
                readOnly
                disabled
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Attachments sent with this request</Label>
              <ul className="flex flex-col gap-1 rounded-md border border-border/70 bg-muted/40 p-2">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.fileId}
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
              <p className="text-xs text-muted-foreground">
                The rejected copy stays attached so the {label.toLowerCase()}{" "}
                can see exactly what the certifier reviewed.
              </p>
            </div>

            <ExtraAttachmentsField
              onUploadingChange={setIsAttachingExtras}
              projectId={projectId}
              value={extras}
              onChange={setExtras}
              vaultOptions={vaultOptions}
              disabled={isSending}
              hint="Add marked-up feedback, supporting drawings, or anything else needed to complete the revision."
            />
          </aside>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              isSending ||
              isAttachingExtras ||
              !emailBody.html.trim() ||
              attachments.length === 0
            }
            onClick={() => void handleSend()}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send revision request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
