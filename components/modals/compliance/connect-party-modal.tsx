"use client";

import { CompliancePartyType } from "@prisma/client";
import { FileText, Loader2, Paperclip, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  ContactPicker,
  type ContactOption,
} from "@/components/modals/compliance/contact-picker";
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
import {
  LAND_DEED_DOCUMENT,
  PARTY_LABEL,
  PARTY_TRADE_LABEL,
} from "@/constants/complianceDocuments";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  startPartyOutreach,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";

/** A file already on the compliance file that this outreach will carry. */
export type PrefilledAttachment = { name: string; url: string };

type ConnectPartyModalProps = {
  projectId: string;
  party: CompliancePartyType;
  subjectAddress: string;
  /**
   * What the send will attach, resolved by the caller off the document rows.
   *
   * Shown rather than chosen. By the time an architect can be engaged the
   * surveyor's three documents are on the file by definition, and offering them
   * as checkboxes would invite somebody to send an architect a site with no
   * survey on it. The surveyor's own list is empty until the deed below is
   * uploaded, which is the one attachment this modal collects.
   */
  prefilled: PrefilledAttachment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Engages a surveyor or an architect, and sends their opening email.
 *
 * Deliberately the same shape as the certifier's modal: a contact picked from
 * the directory, the site address for the subject, and the send. The two things
 * it adds are what the mail will carry — listed, not chosen — and, for the
 * surveyor, the land deed, which is the one input this party needs and the one
 * document nobody else on the file supplies.
 */
export function ConnectPartyModal({
  projectId,
  party,
  subjectAddress,
  prefilled,
  open,
  onOpenChange,
}: ConnectPartyModalProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.party(party)),
  );
  const isPending = mutation.status === "pending";

  const { uploadFile, isUploading } = useComplianceUpload(projectId);
  const deedScope = complianceScope.document({
    documentType: LAND_DEED_DOCUMENT.type,
  });
  const deedMutation = useAppSelector(selectComplianceMutation(deedScope));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contact, setContact] = useState<ContactOption | null>(null);
  const [note, setNote] = useState("");
  const [deed, setDeed] = useState<PrefilledAttachment | null>(null);
  /**
   * The deed upload, from the first byte to the row being linked.
   *
   * Held locally rather than read off the hook or the store, because neither
   * covers the whole operation and the gaps are where this went wrong. The
   * hook's flag ends when the transfer does; the store's begins when the
   * attach request is dispatched; between them sits the settle the File row
   * needs to become visible. The control was live across both gaps, so a
   * second click during the settle started a parallel upload against the same
   * document, and Send became clickable for an outreach whose only attachment
   * did not exist yet.
   */
  const [isAttachingDeed, setIsAttachingDeed] = useState(false);

  // OR-ed with the two narrower signals rather than replacing them. This one is
  // the authority for work this modal started; the others still catch a write
  // to the same document from somewhere else, which is the case the scope key
  // exists to serialise.
  const isDeedBusy =
    isAttachingDeed ||
    isUploading(deedScope) ||
    deedMutation.status === "pending";

  const label = PARTY_LABEL[party];
  const trade = PARTY_TRADE_LABEL[party];
  const needsDeed = party === CompliancePartyType.SURVEYOR;

  /**
   * The deed is attached to the file before the outreach is sent, not with it.
   *
   * The send reads its attachments off the document rows rather than off
   * anything passed in, so the deed has to be a row by then. Doing it here also
   * means a deed uploaded against a send that then fails is not lost — it is on
   * the file, and the retry finds it already there.
   */
  const handleDeed = async (file: File) => {
    // Claimed before the first await, so the control is disabled on the same
    // tick the picker closes rather than one render later.
    if (isDeedBusy) return;
    setIsAttachingDeed(true);

    try {
      const uploaded = await uploadFile(file, deedScope);
      // The same settle the tab's own uploads wait out: the File row is written
      // by /api/upload and is not always visible to the next query immediately.
      await new Promise((resolve) => setTimeout(resolve, 850));
      await dispatch(
        uploadComplianceDocument({
          projectId,
          fileId: uploaded.fileId,
          documentType: LAND_DEED_DOCUMENT.type,
        }),
      ).unwrap();
      setDeed({ name: uploaded.name, url: uploaded.url });
      toast.success(`${file.name} attached.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not upload ${file.name}.`,
      );
    } finally {
      // In a finally, so a failed transfer or a rejected attach releases the
      // control instead of stranding the modal on a deed that never landed.
      setIsAttachingDeed(false);
    }
  };

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contact) return;

    try {
      await dispatch(
        startPartyOutreach({
          projectId,
          party,
          tradieId: contact.tradieId,
          contactName: contact.name || undefined,
          contactEmail: contact.email.trim().toLowerCase(),
          contactPhone: contact.phone ?? undefined,
          note: note.trim() || undefined,
        }),
      ).unwrap();
      toast.success(`${label} engaged.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not engage the ${label.toLowerCase()}.`,
      );
    }
  };

  const attachments = needsDeed ? (deed ? [deed] : []) : prefilled;
  const canSubmit =
    Boolean(contact) && !isPending && !isDeedBusy && (!needsDeed || Boolean(deed));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect with {label}</DialogTitle>
            <DialogDescription>
              {needsDeed
                ? "They are sent the land deed and asked for the deposited plan, title search and survey. Their reply is matched back by the reference in the subject line."
                : "They are sent everything the surveyor produced and asked for the plans. Their reply is matched back by the reference in the subject line."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{label}</Label>
              {trade ? (
                <ContactPicker
                  trade={trade}
                  label={label}
                  value={contact}
                  onChange={setContact}
                  disabled={isPending}
                />
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="party-subject-address">Site address</Label>
              {/* Read-only. It is the engagement's, set when the certifier was
                  connected, and every thread on this file has to quote the same
                  one — the inbound correlation matches a subject against it. */}
              <Input id="party-subject-address" value={subjectAddress} readOnly disabled />
            </div>

            {needsDeed ? (
              <div className="space-y-2">
                <Label>{LAND_DEED_DOCUMENT.label}</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleDeed(file);
                  }}
                />
                {deed ? (
                  <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">{deed.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending || isDeedBusy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {isDeedBusy ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Replace
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={isPending || isDeedBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isDeedBusy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="size-4" aria-hidden="true" />
                    )}
                    {/* The label follows the operation rather than staying put,
                        because the slow half is the part after the bytes have
                        gone: a spinner still reading "Upload the land deed"
                        looks stuck rather than busy. */}
                    {isDeedBusy ? "Attaching…" : "Upload the land deed"}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Sent with the request — the surveyor cannot start without it.
                </p>
              </div>
            ) : null}

            {!needsDeed ? (
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
                  <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-light px-3 py-2 text-xs text-foreground">
                    <X className="size-3.5 shrink-0" aria-hidden="true" />
                    Nothing on the file to send yet.
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="party-note">Anything to add</Label>
              <Textarea
                id="party-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional — goes into the email as its own line."
                disabled={isPending}
              />
            </div>
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
            <Button type="submit" disabled={!canSubmit}>
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
