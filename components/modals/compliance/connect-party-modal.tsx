"use client";

import { ComplianceDocumentType, CompliancePartyType } from "@prisma/client";
import { FileText, Loader2, Paperclip, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ContactPicker,
  type ContactOption,
} from "@/components/modals/compliance/contact-picker";
import {
  DeveloperPicker,
  type DeveloperOption,
} from "@/components/modals/compliance/developer-picker";
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
import {
  complianceDocumentLabel,
  isApprovalParty,
  isConsultantParty,
  LAND_DEED_DOCUMENT,
  PARTY_LABEL,
  PARTY_TRADE_LABEL,
  partyDeliverables,
} from "@/constants/complianceDocuments";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  buildPartyOutreachBody,
  type OutreachClientDetails,
} from "@/lib/domain/compliance/party-outreach-email";
import { emailHtmlToLeadNotesDocument } from "@/lib/rich-text/lead-notes";
import type { LeadRichTextDocument } from "@/lib/leads/types";
import type { VaultAttachmentOption } from "@/types/compliance";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  startPartyOutreach,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";

/** A file already on the compliance file that this outreach will carry. */
export type PrefilledAttachment = { name: string; url: string };

/**
 * "a, b and c" — the list as a sentence reads it.
 *
 * A join with " and " was right while every consultant produced one thing and
 * the surveyor produced three. A structural engineer produces three, and
 * "structural drawings and hydraulic drawings and a geotechnical report" reads
 * like a transcription error.
 */
function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

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
  /**
   * The checklist line this consultant is being engaged against.
   *
   * Only set for a consultant party, and carried straight through to the
   * outreach so what they send back can answer the item that asked for it. A
   * surveyor is engaged against the job; a bushfire consultant is engaged
   * against item 9.
   */
  checklistDocumentId?: string;
  /**
   * Every line this engagement is meant to answer, one per document.
   *
   * The reason `checklistDocumentId` alone stopped being enough. A bushfire
   * assessor answers one line and a structural engineer answers three — the
   * drawings, the hydraulic set and the geotechnical report — off a single
   * engagement, and the reply that carries two PDFs has to file each against
   * the line that asked for it.
   *
   * Resolved by the caller off the checklist rather than here, because only the
   * tab can see which of the certifier's lines ask for which of the three.
   */
  deliverables: {
    documentType: ComplianceDocumentType;
    checklistDocumentId?: string;
  }[];
  /**
   * The project's council and address, for the developer picker only.
   *
   * Used to put the estate this lot is probably in at the top of the list. Both
   * are optional and both are only ever hints — see `developersForArea`, which
   * orders rather than filters, because every way of recognising an estate from
   * a project row is wrong often enough to hide the right answer.
   */
  council?: string | null;
  location?: string | null;
  /** The project owner details included in the architect's generated email. */
  customer: OutreachClientDetails;
  /** Existing files and uploads available as optional extra attachments. */
  vaultOptions?: readonly VaultAttachmentOption[];
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
  checklistDocumentId,
  deliverables,
  council,
  location,
  customer,
  vaultOptions,
  open,
  onOpenChange,
}: ConnectPartyModalProps) {
  const dispatch = useAppDispatch();
  const outreachKey = useIdempotencyKey();
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
  const [extras, setExtras] = useState<ExtraAttachment[]>([]);
  const [isAttachingExtras, setIsAttachingExtras] = useState(false);
  /**
   * Which estate, for a developer.
   *
   * Held separately from `contact` rather than folded into it, because the two
   * are picked from different places and carry different things: a contact is a
   * tradie row with an id this outreach records, and this is an entry in a list
   * in the codebase whose address may well be blank. What they have in common
   * is only that both end up as a name and an address on the send, which is
   * what `resolvedContact` below does with them.
   */
  const [developer, setDeveloper] = useState<DeveloperOption | null>(null);
  const [deed, setDeed] = useState<PrefilledAttachment | null>(
    () => prefilled[0] ?? null,
  );
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
    isAttachingDeed
    || isUploading(deedScope)
    || deedMutation.status === "pending";

  const label = PARTY_LABEL[party];
  const trade = PARTY_TRADE_LABEL[party];
  const needsDeed = party === CompliancePartyType.SURVEYOR;
  const isConsultant = isConsultantParty(party);
  const isApproval = isApprovalParty(party);

  /**
   * Who this is being sent to, whichever picker supplied them.
   *
   * One shape for the submit, so the send does not have to know which of the
   * two ways of choosing a correspondent was used. `tradieId` is absent for a
   * developer by definition — they are not in the directory, which is the whole
   * reason the second picker exists.
   */
  const resolvedContact = isApproval
    ? developer && developer.email.trim()
      ? {
          tradieId: undefined,
          name: developer.name,
          email: developer.email,
          phone: developer.phone ?? undefined,
        }
      : null
    : contact
      ? {
          tradieId: contact.tradieId,
          name: contact.name || undefined,
          email: contact.email,
          phone: contact.phone ?? undefined,
        }
      : null;
  /** What this party is being asked to produce, in the reader's words. */
  const wanted = listSentence(
    partyDeliverables(party).map((type) =>
      complianceDocumentLabel(type).toLowerCase(),
    ),
  );

  const generatedBodyHtml = useMemo(
    () =>
      buildPartyOutreachBody({
        party,
        contactName: resolvedContact?.name ?? null,
        subjectAddress,
        estate: developer?.estate,
        client: party === CompliancePartyType.ARCHITECT ? customer : null,
      }),
    [customer, developer?.estate, party, resolvedContact?.name, subjectAddress],
  );
  const generatedEmailDocument = useMemo(
    () => emailHtmlToLeadNotesDocument(generatedBodyHtml),
    [generatedBodyHtml],
  );
  const recipientKey = resolvedContact
    ? `${resolvedContact.tradieId ?? developer?.key ?? ""}:${resolvedContact.email}:${resolvedContact.name ?? ""}`
    : "unselected";
  const [emailDraft, setEmailDraft] = useState<{
    recipientKey: string;
    document: LeadRichTextDocument;
  }>({ recipientKey, document: generatedEmailDocument });
  const emailBody =
    emailDraft.recipientKey === recipientKey
      ? emailDraft.document
      : generatedEmailDocument;

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
      const uploaded = await uploadFile(file, deedScope, {
        rootTrail: true,
        trail: ["Project", "Compliance", `Connect with ${label}`, "Land deed"],
        tags: ["Compliance", label, "Land deed"],
      });
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
        error instanceof Error
          ? error.message
          : `Could not upload ${file.name}.`,
      );
    } finally {
      // In a finally, so a failed transfer or a rejected attach releases the
      // control instead of stranding the modal on a deed that never landed.
      setIsAttachingDeed(false);
    }
  };

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolvedContact) return;

    try {
      await dispatch(
        startPartyOutreach({
          projectId,
          party,
          tradieId: resolvedContact.tradieId,
          contactName: resolvedContact.name || undefined,
          contactEmail: resolvedContact.email.trim().toLowerCase(),
          contactPhone: resolvedContact.phone,
          body: emailBody.html.trim(),
          checklistDocumentId,
          deliverables,
          extraAttachmentIds: extraAttachmentIds(extras),
          developerKey: developer?.key,
          // The opening email carries the pack. One key per attempt, so a
          // resubmit of this form cannot send a consultant two copies.
          idempotencyKey: outreachKey.current(),
        }),
      ).unwrap();
      outreachKey.rotate();
      toast.success(`${label} engaged.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not engage the ${label.toLowerCase()}.`,
      );
    }
  };

  const attachments = needsDeed ? (deed ? [deed] : []) : prefilled;
  const canSubmit =
    Boolean(resolvedContact)
    && Boolean(emailBody.html.trim())
    && !isPending
    && !isDeedBusy
    && !isAttachingExtras
    && (!needsDeed || Boolean(deed));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect with {label}</DialogTitle>
            <DialogDescription>
              {/* Said in terms of what actually goes out, because that is the
                  thing somebody is deciding about when they pick a firm. The
                  consultant line names the checklist item rather than the
                  documents: they are being commissioned for one deliverable,
                  and what is attached is only the material to assess it
                  against. */}
              {isApproval
                ? "They are sent the bushfire report with the plans and the survey it was assessed against, and asked to approve it. A reply saying yes or no is read off the thread and recorded here; you can also record their answer by hand."
                : needsDeed
                  ? "They are sent the land deed and asked for the deposited plan, title search and survey. Their reply is matched back by the reference in the subject line."
                  : isConsultant
                    ? // What they are sent is listed below rather than described
                      // here, because it now differs per consultant: a bushfire
                      // assessor reads the certificate, a structural engineer
                      // reads the full design, and a sentence naming one of those
                      // sets would be wrong for the other.
                      `They are asked for the ${wanted}, with what they need to work from attached. What they send back answers the checklist ${
                        deliverables.length > 1 ? "items" : "item"
                      } this was raised from.`
                    : "They are sent the surveyor's set and the planning certificate, the client's details so they can sit down with the owners, and asked for the plans. Their reply is matched back by the reference in the subject line."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)]">
            <section
              className="min-w-0 space-y-2"
              aria-labelledby="party-email-body-label"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p
                    id="party-email-body-label"
                    className="text-sm font-semibold text-foreground"
                  >
                    Email body
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Review and edit the message before it is sent.
                  </p>
                </div>
                <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Editable draft
                </span>
              </div>
              <LeadRichTextEditor
                key={recipientKey}
                value={emailBody}
                availableUsers={[]}
                onChange={(document) =>
                  setEmailDraft({ recipientKey, document })
                }
                onSaveNote={() => undefined}
                canSaveNote={false}
                isSavingNote={false}
                hideSaveButton
                hideMentionInfo
                disabled={isPending}
                placeholder="Write the email body…"
                ariaLabelledBy="party-email-body-label"
              />
            </section>

            <aside className="min-w-0 space-y-4 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Delivery details
                </p>
                <Label>{label}</Label>
                {isApproval ? (
                  // Its own picker rather than the directory's. A developer is
                  // not a trade, is never scheduled and is never paid, and the
                  // list they come from is keyed by the estate a lot sits in.
                  <DeveloperPicker
                    council={council}
                    location={location}
                    value={developer}
                    onChange={setDeveloper}
                    disabled={isPending}
                  />
                ) : trade ? (
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
                <Input
                  id="party-subject-address"
                  value={subjectAddress}
                  readOnly
                  disabled
                />
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
                      <FileText
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {deed.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending || isDeedBusy}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {isDeedBusy ? (
                          <Loader2
                            className="size-4 animate-spin"
                            aria-hidden="true"
                          />
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
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
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
                    Sent with the request — the surveyor cannot start without
                    it.
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Attachments sent with this request</Label>
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
                        <span className="min-w-0 truncate">
                          {attachment.name}
                        </span>
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

              <ExtraAttachmentsField
                uploadHints={{
                  trail: ["Project", "Compliance", `Connect with ${label}`],
                  tags: ["Compliance", label],
                }}
                onUploadingChange={setIsAttachingExtras}
                projectId={projectId}
                value={extras}
                onChange={setExtras}
                vaultOptions={vaultOptions}
                disabled={isPending}
                hint={
                  isApproval
                    ? "The covenant schedule, the contract of sale — anything the estate asks to see alongside the report."
                    : "Anything else this request should carry, on top of what is listed above."
                }
              />
            </aside>
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
