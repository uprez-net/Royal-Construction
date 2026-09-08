"use client";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";
import {
  ClipboardList,
  ExternalLink,
  HelpCircle,
  Inbox,
  Loader2,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CERTIFIER_RESPONSE_DOCUMENTS,
  COMPLIANCE_PARTY_SECTIONS,
  complianceDocumentLabel,
  HBCF_INSURANCE_URL,
  isApprovableDocumentType,
  isNotRequired,
  isOutstandingEvidence,
  isRequiredDocumentType,
  isReviewSubmissionType,
  isOptionalForOutreach,
  isSignedCopyType,
  PARTY_LABEL,
  PARTY_OUTREACH_ATTACHMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  applicableRequiredDocuments,
  canSendRequiredPack,
  hasReachedChecklistStage,
  hasSentRequiredPack,
  isRequiredPackComplete,
  unsentRequiredDocuments,
} from "@/lib/compliance/required-pack";
import {
  packSendBlockedReason,
  partyBlockedReason,
} from "@/lib/compliance/prerequisites";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  complianceScope,
  identifyComplianceDocument,
  resolveComplianceDocument,
  selectComplianceMutations,
  recordPartySelfSupplied,
  requestUpdatedTitleSearch,
  sendCertifierReply,
  sendPartyReply,
  setComplianceDocumentNotRequired,
  uploadComplianceDocument,
  type ComplianceScope,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";
import {
  checklistItemDetail,
  outreachForParty,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
  type ComplianceAlertRecord,
  type ComplianceDocumentWithFiles,
} from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";
import {
  COMPLIANCE_ALERT_COPY,
  ComplianceAlertsPanel,
} from "./compliance-alerts-panel";
import { ArchitectWorkflow } from "./architect-workflow";
import { ComplianceThreadsModal } from "./compliance-threads-modal";
import { DaApprovalSection } from "./da-approval-section";
import { PartyDocumentSection } from "./party-document-section";
import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceDocumentVault } from "./compliance-document-vault";
import { ComplianceFinalPage } from "./compliance-final-page";
import { ComplianceSectionCard } from "./compliance-section-card";

/**
 * Statuses that mean the signed copies have already gone to the certifier.
 *
 * `SIGNING` is claimed exactly once by the send, and every later status is
 * downstream of it, so this doubles as "have the signatures actually been
 * sent" — which is what gates asking the certifier for a checklist. Uploading
 * the two files is not the same thing, and gating on that let an admin ask for
 * a checklist against signatures still sitting in our own storage.
 */
const SIGNED_COPIES_SENT: ReadonlySet<CertifierEngagementStatus> = new Set([
  CertifierEngagementStatus.SIGNING,
  CertifierEngagementStatus.CHECKLIST_EXTRACTING,
  CertifierEngagementStatus.CHECKLIST_TRACKING,
  CertifierEngagementStatus.INSURANCE,
  CertifierEngagementStatus.IN_REVIEW,
  CertifierEngagementStatus.APPROVED,
]);

/**
 * Statuses the review send is offered from.
 *
 * Narrower than what `sendComplianceForReview` will accept, and deliberately
 * so. The server still allows a re-send out of IN_REVIEW; nothing on the tab
 * asks for one. The whole set goes over once, when the collection finishes for
 * the first time — after that the file is with the certifier and a replacement
 * is a message about one document, which the server already sends on its own
 * with the new file attached. Offering the bulk send on top of that put two
 * emails on the thread for a single upload, the second of them re-attaching
 * every checklist file the certifier was already reading.
 */
const READY_FOR_REVIEW_STATUSES: ReadonlySet<CertifierEngagementStatus> =
  new Set([
    CertifierEngagementStatus.CHECKLIST_TRACKING,
    CertifierEngagementStatus.INSURANCE,
  ]);

/** The checklist evidence and the insurance certificate — what the send carries. */
const reviewSubmission = (engagement: CertifierEngagementDetail) =>
  engagement.documents.filter((document) =>
    isReviewSubmissionType(document.documentType),
  );

/**
 * Whether the collection phase has just finished, for the first time.
 *
 * Goes false the moment the file is with the certifier and never comes back:
 * IN_REVIEW is not in the set above, so this is what holds the review send to
 * one send.
 *
 * Measured over the send set alone, and gated on the checklist existing. Both
 * halves were learned the hard way: counting every document the builder
 * supplied meant the six required rows satisfied the condition on their own,
 * before the certifier had issued anything, and the upload that completed the
 * required pack opened the completion prompt in the middle of collection.
 *
 * One function for the prompt and the send bar both, because the two claiming
 * different things about the same engagement is what the drift would look like.
 */
function isReadyForReview(engagement: CertifierEngagementDetail): boolean {
  if (!READY_FOR_REVIEW_STATUSES.has(engagement.status)) {
    return false;
  }

  const submission = reviewSubmission(engagement);
  const hasChecklist = submission.some(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  // A line the admin marked as not applying to this job is answered, not
  // missing. Counting it left the send unreachable over a document nobody was
  // ever going to supply.
  return hasChecklist && !submission.some(isOutstandingEvidence);
}

/**
 * The collapsible blocks the tab is built from, in flow order.
 *
 * "required" is gone: what was one card is now one per supplier, keyed by the
 * party, because they open and close independently and the flow moves through
 * them one at a time.
 */
type SectionKey =
  | CompliancePartyType
  | "unidentified"
  | "response"
  | "checklist"
  | "vault";

type ProjectComplianceTabProps = {
  project: ProjectDetail;
  isAdmin: boolean;
};

export function ProjectComplianceTab({
  project,
  isAdmin,
}: ProjectComplianceTabProps) {
  const dispatch = useAppDispatch();
  const complianceMutations = useAppSelector(selectComplianceMutations);
  const { uploadFile, isUploading } = useComplianceUpload(project.id);

  /**
   * Whether one scope has a write in flight.
   *
   * Both halves count, and they are consecutive rather than concurrent: an
   * upload is a transfer to blob storage followed by a request pointing a
   * document at it, and the control has to stay disabled across the join. The
   * transfer is local to this component and the request is in the store, which
   * is why the two are read from different places and OR-ed here.
   */
  const isScopeBusy = (scope: ComplianceScope) =>
    isUploading(scope) || complianceMutations[scope]?.status === "pending";

  /**
   * Whether any of several scopes is busy.
   *
   * What the sends are gated on. A send carries a set of documents, so it has
   * to be blocked by a write to any of them as well as by its own request —
   * offering "Send it to Certifier" while a checklist item is midway through
   * being replaced would post a set the admin is still changing.
   */
  const isAnyScopeBusy = (scopes: readonly ComplianceScope[]) =>
    scopes.some(isScopeBusy);

  /** The scope a document row files its writes under. */
  const scopeOf = (
    document: ComplianceDocumentWithFiles | undefined,
    documentType?: ComplianceDocumentType,
  ) =>
    complianceScope.document({
      documentId: document?.id,
      documentType,
    });
  const [insuranceAnswer, setInsuranceAnswer] = useState<"yes" | "no" | null>(
    null,
  );
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  /**
   * Which blocks the reader has opened or shut by hand.
   *
   * Sparse on purpose: anything absent falls back to the active section, so
   * a card left alone keeps following the flow as the engagement moves on,
   * while one that was clicked stays where it was put.
   */
  const [sections, setSections] = useState<
    Partial<Record<SectionKey, boolean>>
  >({});

  const engagement = project.certifierEngagement;

  const documentsByType = useMemo(() => {
    const map = new Map<ComplianceDocumentType, ComplianceDocumentWithFiles>();
    for (const document of engagement?.documents ?? []) {
      if (!map.has(document.documentType)) {
        map.set(document.documentType, document);
      }
    }
    return map;
  }, [engagement]);

  /**
   * Every file on the engagement, in the order the documents are listed.
   *
   * This is the gallery pool. Opening a site photo attached to one checklist
   * item lets the viewer page through every other photo on the engagement,
   * rather than the one or two on that row.
   */
  const previewFiles = useMemo(
    () =>
      (engagement?.documents ?? []).flatMap((document) =>
        document.files.map((file) => ({
          id: file.id,
          url: file.url,
          name: file.filename,
          fileType: file.fileType,
        })),
      ),
    [engagement],
  );

  const handlePreviewFile = (fileId: string) => {
    const index = previewFiles.findIndex((file) => file.id === fileId);
    const action = filePreviewModal(previewFiles, index);
    if (action) dispatch(openModal(action));
  };

  /**
   * Required documents the certifier does not have the current copy of.
   *
   * The same reading `sendUpdatedRequiredDocuments` does on the server — off
   * the mail trail, not off the status — so the send offered here and the mail
   * it produces cannot disagree about what is outstanding.
   */
  const unsentRequired = useMemo(
    () => (engagement ? unsentRequiredDocuments(engagement) : []),
    [engagement],
  );

  const checklistItems = useMemo(
    () =>
      (engagement?.documents ?? [])
        .filter(
          (document) =>
            document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
        )
        .sort((a, b) => a.order - b.order),
    [engagement],
  );

  /** Attachments the classifier could not place, and nobody has labelled yet. */
  const unidentified = useMemo(
    () =>
      (engagement?.documents ?? []).filter(
        (document) =>
          document.documentType === ComplianceDocumentType.UNKNOWN &&
          document.files.length > 0,
      ),
    [engagement],
  );

  /** What the review send carries, and therefore what "all N documents" counts. */
  const submissionDocuments = useMemo(
    () => (engagement ? reviewSubmission(engagement) : []),
    [engagement],
  );

  const inReview = engagement?.status === CertifierEngagementStatus.IN_REVIEW;
  const allEvidenceIn = engagement ? isReadyForReview(engagement) : false;

  /**
   * Which controls a row shows.
   *
   * Only checklist evidence is ever decided on. Everything else the builder
   * supplied is uploadable right up until the file goes over, and frozen from
   * then on — not because it is awaiting a verdict, but because the certifier
   * is reading the copy we sent and it must not move underneath them.
   *
   * Within the checklist, the rejected case is the one that matters. A
   * rejection sends the item back to PENDING while the engagement stays in
   * review, so it has to offer Upload again — showing Approve/Reject there, as
   * this did, left the loop unable to finish, because an admin could only
   * re-reject an item nobody had any way to re-supply.
   */
  const rowMode = (
    document?: ComplianceDocumentWithFiles,
  ): "upload" | "resolve" | "frozen" => {
    if (document?.status === ComplianceDocumentStatus.APPROVED) return "frozen";

    // Settled without a document behind it. The row keeps the control that puts
    // it back, which the row renders itself; it offers nothing else.
    if (document && isNotRequired(document.status)) return "frozen";

    // The pack and the signed forms are settled once the certifier has issued
    // a checklist. Nothing in the flow re-sends them from there — the send that
    // did is closed off at the same line — and a replacement now deletes what
    // it replaces, so Replace here would destroy the copy the certifier is
    // working from with no way to put it back. Corrections to a document they
    // already hold go out on the thread, as one message about one file.
    if (
      document &&
      engagement &&
      !canSendRequiredPack(engagement) &&
      (isRequiredDocumentType(document.documentType) ||
        isSignedCopyType(document.documentType))
    ) {
      return "frozen";
    }

    if (!inReview) return "upload";
    // Sent back. The old file is still attached, so a row that only asked "has
    // it got a file?" showed Approve/Reject here and left the loop unable to
    // finish — an admin could re-reject an item nobody had a way to re-supply.
    if (document?.rejectionReason) return "upload";
    if (!document || document.files.length === 0) return "upload";
    if (!isApprovableDocumentType(document.documentType)) return "frozen";
    return isAdmin ? "resolve" : "frozen";
  };

  /**
   * Opens the send prompt when the required pack has just become whole.
   *
   * The pack is the one part of the flow with no natural end: the six rows sit
   * there filling up and nothing announces that the last one has landed, so an
   * admin who collected them by hand rather than through the discovery loop was
   * left with a completed section and no indication that anything happens next.
   *
   * It fires on a replacement too, which is the second reading it carries — the
   * certifier is working from a superseded copy from the moment the upload
   * lands, and that is worth saying rather than leaving to be noticed. Held to
   * the same evidence the send bar uses, so a pack the certifier already has in
   * full prompts nothing.
   */
  const promptIfPackReady = (
    next: CertifierEngagementDetail | null,
    uploadedType: ComplianceDocumentType,
  ) => {
    if (!isRequiredDocumentType(uploadedType)) return;
    if (!next || !isRequiredPackComplete(next)) return;
    // Past the checklist the pack is no longer something the flow sends, so
    // completing it again is not news. Replacing a document there is a message
    // about one file, which the thread composer carries.
    if (!canSendRequiredPack(next)) return;

    const outstanding = unsentRequiredDocuments(next);
    if (outstanding.length === 0) return;

    dispatch(
      openModal({
        type: "certifierPackReady",
        payload: {
          projectId: project.id,
          documentCount: applicableRequiredDocuments(next).length,
          updatedCount: outstanding.length,
          isResend: hasSentRequiredPack(next),
        },
      }),
    );
  };

  /**
   * Opens the completion prompt when the set becomes whole for the first time.
   *
   * Called with the engagement the server returned rather than from an effect,
   * so the decision is made against what was actually written instead of a
   * render that may not have happened yet.
   *
   * `isReadyForReview` is what holds it to the first time. Once the file has
   * gone for review the engagement is past the statuses it reads, so replacing
   * a checklist item there prompts nothing — which is the point. The server
   * answers a replacement with its own message about that one document, and
   * this used to put a second email behind it re-sending the entire set.
   */
  const promptIfComplete = (
    next: CertifierEngagementDetail | null,
    uploadedType: ComplianceDocumentType,
  ) => {
    // Only an upload that is part of the send can be the one that completes it.
    // Without this the prompt fired on any upload at all once the set happened
    // to be whole — replacing a required document while the checklist was live
    // opened "Compliance and Certification complete" over a document that has
    // nothing to do with the send.
    if (!isReviewSubmissionType(uploadedType)) return;
    if (!next || !isReadyForReview(next)) return;

    dispatch(
      openModal({
        type: "complianceComplete",
        payload: {
          projectId: project.id,
          documentCount: reviewSubmission(next).length,
        },
      }),
    );
  };

  /**
   * Uploads a file and points a compliance document at it.
   *
   * One helper for every upload control on the tab, because they differ only in
   * which document they target — a seeded row by id, or a type that has no row
   * until now. Returns the engagement as the server left it, so the caller can
   * decide what follows without waiting for a re-render.
   */
  const attach = async (
    file: File,
    target: { documentId?: string; documentType?: ComplianceDocumentType },
  ): Promise<CertifierEngagementDetail | null> => {
    // The transfer and the request that follows it are filed under the same
    // key, so the row stays busy for the whole operation rather than going
    // idle in the gap between them. Derived here rather than passed in: a
    // caller free to invent its own key is a caller free to disagree with the
    // scope the store will end up writing to.
    const key = complianceScope.document(target);
    try {
      const uploaded = await uploadFile(file, key);
      // Set a small timeout to wait for the file entry to be created in the database before trying to attach it to a document. This is a workaround for a race condition that
      // can occur when uploading large files, where the file entry may not be immediately available in the database after the upload completes.
      await new Promise((resolve) => setTimeout(resolve, 850));
      const result = await dispatch(
        uploadComplianceDocument({
          projectId: project.id,
          fileId: uploaded.fileId,
          ...target,
        }),
      ).unwrap();
      toast.success(`${file.name} uploaded.`);
      return result.engagement;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not upload ${file.name}.`,
      );
      return null;
    }
  };

  /**
   * A required document, a checklist item, or the insurance certificate.
   *
   * `documentType` is required even where an id already identifies the row —
   * the server ignores it then, but the completion prompt needs to know what
   * was just uploaded to decide whether it has any bearing on the send.
   */
  const attachEvidence = async (
    file: File,
    target: { documentId?: string; documentType: ComplianceDocumentType },
  ) => {
    // Read before the upload clears it. A row carrying a rejection reason is
    // one the certifier sent back, and the server answers that upload with its
    // own mail on the thread — so the bulk re-send prompt is not offered on top
    // of it. Two messages about the same fix, one of them asking whether to
    // send the whole set again, is not what anybody meant by re-supplying.
    const before = target.documentId
      ? engagement?.documents.find(
          (document) => document.id === target.documentId,
        )
      : documentsByType.get(target.documentType);
    const wasSentBack = Boolean(before?.rejectionReason);

    const next = await attach(file, target);
    if (wasSentBack) return;

    // Two prompts, never on the same upload: one watches the required pack and
    // the other what the review send carries, and no document type is in both.
    promptIfPackReady(next, target.documentType);
    promptIfComplete(next, target.documentType);
  };

  /**
   * A signed copy, which is the one upload with something to do afterwards.
   *
   * The certifier will not issue a checklist until they have both signatures,
   * and nothing else in the flow would ever send them — so the send fires off
   * the upload that completes the pair. Checked against the engagement the
   * server just returned rather than the rendered one, which is still a version
   * behind at this point.
   */
  const attachSignedCopy = async (
    file: File,
    signedType: ComplianceDocumentType,
    documentId?: string,
  ) => {
    const next = await attach(file, {
      documentId,
      documentType: signedType,
    });
    if (!next) return;

    const bothPresent = SIGNED_COPY_DOCUMENTS.every((copy) =>
      next.documents.some(
        (document) =>
          document.documentType === copy.type && document.files.length > 0,
      ),
    );

    if (bothPresent && !SIGNED_COPIES_SENT.has(next.status)) {
      dispatch(
        openModal({
          type: "certifierSendSignedCopies",
          payload: { projectId: project.id },
        }),
      );
    }
  };

  const handleReply = async (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => {
    await dispatch(
      sendCertifierReply({ projectId: project.id, ...input }),
    ).unwrap();
    toast.success("Sent to the certifier.");
  };

  const handlePartyReply = async (
    outreachId: string,
    input: { body: string; attachments: CertifierReplyAttachment[] },
  ) => {
    await dispatch(
      sendPartyReply({ projectId: project.id, outreachId, ...input }),
    ).unwrap();
    toast.success("Message sent.");
  };

  /**
   * Opens the connect modal for one party.
   *
   * The attachments the send will carry are resolved here rather than in the
   * modal, off the same document rows the server reads. The modal lists them so
   * whoever is sending can see what an architect is about to receive, and it
   * cannot choose them — by the time an architect can be engaged the surveyor's
   * three documents are on the file by definition, and a checkbox there would
   * only be an invitation to send a site with no survey on it.
   */
  const handleConnectParty = (party: CompliancePartyType) => {
    const attachmentTypes = new Set<ComplianceDocumentType>(
      PARTY_OUTREACH_ATTACHMENTS[party],
    );
    const prefilled = (engagement?.documents ?? [])
      .filter((document) => attachmentTypes.has(document.documentType))
      .flatMap((document) =>
        document.files.map((file) => ({
          name: file.filename,
          url: file.url,
        })),
      );

    dispatch(
      openModal({
        type: "connectComplianceParty",
        payload: {
          projectId: project.id,
          party,
          subjectAddress: engagement?.subjectAddress ?? project.location,
          prefilled,
        },
      }),
    );
  };

  /**
   * Records that the client turned up with this party's documents.
   *
   * No confirmation dialog, unlike engaging a firm. Nothing is sent, nothing
   * leaves the building, and the only consequence is that the rows below become
   * uploadable — which is what the reader just asked for.
   */
  const handleSelfSupplied = async (party: CompliancePartyType) => {
    try {
      await dispatch(
        recordPartySelfSupplied({ projectId: project.id, party }),
      ).unwrap();
      toast.success(
        `${PARTY_LABEL[party]} documents marked as supplied by the client.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record these as client supplied.",
      );
    }
  };

  /**
   * Asks the surveyor for a fresh title search.
   *
   * No confirmation dialog. The mail composes itself out of the alert — which
   * names are on the register, which we hold — so there is nothing to collect,
   * and the whole point of the button is that it saves someone retyping that
   * off the screen. It does not resolve anything: asking is not fixing, and the
   * alert closes itself when a replacement lands and the names check out.
   */
  const handleRequestTitleSearch = async (alert: ComplianceAlertRecord) => {
    try {
      await dispatch(
        requestUpdatedTitleSearch({ projectId: project.id, alertId: alert.id }),
      ).unwrap();
      toast.success("Asked the surveyor for an updated title search.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send the request to the surveyor.",
      );
    }
  };

  const handleResolveAlert = (alert: ComplianceAlertRecord) => {
    const copy = COMPLIANCE_ALERT_COPY[alert.type];
    dispatch(
      openModal({
        type: "resolveComplianceAlert",
        payload: {
          projectId: project.id,
          alertId: alert.id,
          alertTitle: copy.title,
          guidance: copy.guidance,
        },
      }),
    );
  };

  const handleApprove = async (document: ComplianceDocumentWithFiles) => {
    try {
      await dispatch(
        resolveComplianceDocument({
          projectId: project.id,
          documentId: document.id,
          decision: "approved",
        }),
      ).unwrap();
      toast.success("Approved.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not approve the document.",
      );
    }
  };

  /**
   * Rejection goes through a dialog; approval does not.
   *
   * The asymmetry is the reason. Approving is one click with nothing to say,
   * while sending something back has to carry why — and that reason is read
   * three times over: by whoever re-uploads, on the row until they do, and by
   * the certifier, quoted back to them on the mail that follows the
   * replacement. A `window.prompt` was collecting it in a single unstyled line
   * that froze the tab and, on a phone, the page behind it.
   */
  const handleReject = (document: ComplianceDocumentWithFiles) => {
    dispatch(
      openModal({
        type: "complianceReject",
        payload: {
          projectId: project.id,
          documentId: document.id,
          documentLabel: complianceDocumentLabel(
            document.documentType,
            document.label,
          ),
        },
      }),
    );
  };

  /**
   * Marks a checklist line as not applying to this job, or puts it back.
   *
   * No confirmation dialog, unlike a rejection. There is nothing to collect —
   * the act carries no reason the way a rejection has to — and it is reversible
   * from the same button, which is what makes a single click the right weight
   * for it.
   */
  const handleSetNotRequired = async (
    document: ComplianceDocumentWithFiles,
    notRequired: boolean,
  ) => {
    try {
      await dispatch(
        setComplianceDocumentNotRequired({
          projectId: project.id,
          documentId: document.id,
          notRequired,
        }),
      ).unwrap();
      toast.success(
        notRequired ? "Marked not required." : "Back on the checklist.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the document.",
      );
    }
  };

  const handleIdentify = async (
    documentId: string,
    documentType: ComplianceDocumentType,
  ) => {
    try {
      await dispatch(
        identifyComplianceDocument({
          projectId: project.id,
          documentId,
          documentType,
        }),
      ).unwrap();
      toast.success("Document identified.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not identify the document.",
      );
    }
  };

  // ---------------------------------------------------------------------
  // Nothing started yet — one button, as specified.
  // ---------------------------------------------------------------------

  if (!engagement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Compliance and certification
          </CardTitle>
          <CardDescription>
            Collect the required documents, send them to the principal
            certifier, and track their checklist through to approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            onClick={() =>
              dispatch(
                openModal({
                  type: "startCertifierEngagement",
                  payload: {
                    projectId: project.id,
                    defaultAddress: project.location,
                  },
                }),
              )
            }
          >
            Connect with Certifier
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------
  // Everything approved — the finished file, straight away.
  //
  // It used to sit behind a "View final document list" button on a card whose
  // only other content restated what the final page says in its own header.
  // A closed engagement has one thing left to look at, so this shows it.
  // ---------------------------------------------------------------------

  if (engagement.status === CertifierEngagementStatus.APPROVED) {
    return (
      <ComplianceFinalPage
        documents={engagement.documents}
        projectId={project.id}
        emails={engagement.emails}
        isSendingReply={isScopeBusy(complianceScope.reply)}
        onSendReply={handleReply}
      />
    );
  }

  const collecting =
    engagement.status === CertifierEngagementStatus.NOT_STARTED ||
    engagement.status === CertifierEngagementStatus.COLLECTING_DOCS;

  // Every conversation on the file, not just the certifier's. The badge is a
  // count of what is behind the button, and the button now opens four threads.
  const threadMessageCount =
    engagement.emails.length +
    engagement.outreaches.reduce(
      (total, outreach) => total + outreach.emails.length,
      0,
    );

  // The line the collection half of the tab ends at: past it every control for
  // assembling and sending the pack is describing a step that has happened.
  const inChecklistStage = hasReachedChecklistStage(engagement);

  // Unidentified attachments count as a response: something arrived, it just
  // has not been placed yet. Without this the blocks stayed hidden and the
  // engagement stranded whenever the classifier was unsure.
  const hasResponse =
    unidentified.length > 0 ||
    engagement.documents.some(
      (document) =>
        document.status === ComplianceDocumentStatus.RECEIVED &&
        CERTIFIER_RESPONSE_DOCUMENTS.some(
          (response) => response.type === document.documentType,
        ),
    );

  const signedCopies = SIGNED_COPY_DOCUMENTS.map((signed) => ({
    ...signed,
    document: documentsByType.get(signed.type),
  }));
  const signedCopiesSent = SIGNED_COPIES_SENT.has(engagement.status);

  const checklistDocument = documentsByType.get(
    ComplianceDocumentType.CHECKLIST,
  );
  // Gates the insurance question. A waved-off line must not hold it shut —
  // that is the whole point of being able to wave one off.
  const allChecklistUploaded =
    checklistItems.length > 0 && !checklistItems.some(isOutstandingEvidence);
  const insuranceDocument = documentsByType.get(
    ComplianceDocumentType.HOME_INSURANCE,
  );

  /**
   * The insurance upload, as one target rather than two.
   *
   * The row renders in two branches — a supplied certificate, and the
   * yes/no prompt that precedes it — and they aim at the document differently:
   * the first by id, the second by type, because until a file lands there may
   * be no row to point at. Declaring the target once means the scope the
   * control reads and the scope the request writes cannot disagree, which they
   * silently would if each branch built its own.
   */
  const insuranceUpload = insuranceDocument?.files.length
    ? {
        documentId: insuranceDocument.id,
        documentType: ComplianceDocumentType.HOME_INSURANCE,
      }
    : { documentType: ComplianceDocumentType.HOME_INSURANCE };
  const insuranceScope = complianceScope.document(insuranceUpload);

  // -------------------------------------------------------------------
  // The three supplier blocks.
  //
  // Everything each one needs to render, worked out once here rather than
  // inside the map below: whether its party has been dealt with, what it is
  // still waiting on, and what is blocking it. The blocking rule is the reason
  // this is not three independent cards — the architect and the council both
  // wait on the surveyor's documents rather than on the surveyor's mail, so a
  // surveyor who has been written to but has sent nothing back leaves both
  // still shut. It mirrors `partyPrerequisiteFailure` on the server, which is
  // what actually refuses the send.
  // -------------------------------------------------------------------
  const requiredTypesInPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );

  const partySections = COMPLIANCE_PARTY_SECTIONS.map((section) => {
    // A DA takes the 10.7 certificate out of the pack, which empties the
    // council's section entirely. It stays on screen — its heading is how the
    // reader learns the certificate is no longer wanted — but it is complete
    // by having nothing left to want.
    const types = section.types.filter((type) => requiredTypesInPlay.has(type));
    const documents = types.map((type) => documentsByType.get(type));
    const outstanding = types.filter(
      (type) => !documentsByType.get(type)?.files.length,
    );

    return {
      section,
      party: section.party,
      types,
      documents,
      outreach: outreachForParty(engagement, section.party),
      // Only what the outreach actually waits for. The full architectural
      // design is still outstanding on the progress pill and still chased on
      // the row, but a section held open by it kept the "Now" marker on the
      // architect for the rest of the job -- over the one document the
      // certifier was never going to wait for.
      isComplete: outstanding.every(isOptionalForOutreach),
      outstanding: outstanding.filter((type) => !isOptionalForOutreach(type)),
    };
  });

  /**
   * Why a section cannot be opened yet, in the reader's terms, or null.
   *
   * Read out of `lib/compliance/prerequisites.ts`, which is the same function
   * the server refuses the send with. This used to be its own near-copy of that
   * logic, and the two drifted the moment the architect grew a second
   * prerequisite: the section unlocked, the send was refused, and the two
   * sentences explaining why did not agree.
   */
  const blockedReason = (party: CompliancePartyType): string | null =>
    partyBlockedReason(engagement, party);

  // -------------------------------------------------------------------
  // What each send is blocked by.
  //
  // A send is not just its own request: it carries a set of documents, and
  // posting that set while one of them is halfway through being replaced sends
  // the certifier something nobody meant to send. So each send is gated on its
  // own scope plus the scopes of everything it carries — and on nothing else,
  // which is the point. Work in one block no longer stops work in another.
  // -------------------------------------------------------------------
  const requiredScopes = applicableRequiredDocuments(engagement).map(
    (required) => scopeOf(documentsByType.get(required.type), required.type),
  );
  const signedCopyScopes = signedCopies.map((signed) =>
    scopeOf(signed.document, signed.type),
  );
  const checklistScopes = checklistItems.map((item) =>
    scopeOf(item, ComplianceDocumentType.CHECKLIST_ITEM),
  );

  /** The pack send, and the six documents it puts in the mail. */
  const requiredPackBusy = isAnyScopeBusy([
    complianceScope.outreach,
    ...requiredScopes,
  ]);

  /**
   * Asking for the checklist.
   *
   * Gated on the signed copies rather than on the checklist document, because
   * that is what the request is actually waiting on — and the send of those
   * copies fires off the upload that completes the pair, so the two rows and
   * the send that follows them are one operation as far as this button is
   * concerned.
   */
  const checklistRequestBusy = isAnyScopeBusy([
    complianceScope.signedCopies,
    scopeOf(checklistDocument, ComplianceDocumentType.CHECKLIST),
    ...signedCopyScopes,
  ]);

  /** The review send, and every document it submits. */
  const reviewBusy = isAnyScopeBusy([
    complianceScope.review,
    insuranceScope,
    ...checklistScopes,
  ]);

  /**
   * Whether the review send has claimed the documents it carries.
   *
   * While it is in the air the checklist rows and the insurance row are frozen
   * — not because they are busy in their own right, but because they are the
   * payload, and changing one underneath the request is what this prevents.
   */
  const submissionClaimed = isScopeBusy(complianceScope.review);

  // -------------------------------------------------------------------
  // Which block the flow is waiting on, and therefore which one opens.
  //
  // Read newest-first: an unplaced attachment blocks everything after it, a
  // live checklist supersedes the certifier's first reply, and collecting the
  // pack is where the engagement starts. Cards the reader has not touched
  // follow this, so the tab re-points itself as the engagement moves on.
  // -------------------------------------------------------------------
  const activeSection: SectionKey =
    unidentified.length > 0
      ? "unidentified"
      : checklistItems.length > 0
        ? "checklist"
        : hasResponse
          ? "response"
          // The collection half now has three blocks rather than one, so
          // "where the engagement starts" is the first party that still owes
          // something. Falls back to the surveyor, which is where a file with
          // nothing outstanding began and where a finished one reads fine.
          : (partySections.find((section) => !section.isComplete)?.party ??
            CompliancePartyType.SURVEYOR);

  const isOpen = (key: SectionKey) => sections[key] ?? key === activeSection;
  const toggleSection = (key: SectionKey) => (open: boolean) =>
    setSections((current) => ({ ...current, [key]: open }));

  // -------------------------------------------------------------------
  // Which blocks the engagement has not reached.
  //
  // These used to be the conditions under which the cards rendered at all,
  // which meant the tab showed one card on day one and grew a new one each
  // time the certifier did something — nothing on the page said what the
  // remaining steps were, or that there were any. Same conditions, read the
  // other way round: the blocks are always there, and the ones the flow has
  // not got to yet are shown locked.
  // -------------------------------------------------------------------
  const responseLocked = !hasResponse;
  const checklistLocked = checklistItems.length === 0;

  // Resolved alerts stay listed: what was raised and settled on a job is
  // exactly what somebody auditing it later is looking for, and a list that
  // empties itself as things are fixed leaves no trace that anything was.
  const alerts = engagement.alerts;
  const hasDaAlert = !requiresPlanningCertificate(engagement);

  // Whether the surveyor can be written to at all. The same reading the server
  // takes before it refuses the send, so the button and the request cannot
  // disagree about whether there is a thread.
  const surveyorOutreach = outreachForParty(
    engagement,
    CompliancePartyType.SURVEYOR,
  );
  const canChaseSurveyor = Boolean(
    surveyorOutreach?.contactEmail &&
      surveyorOutreach.mode === ComplianceOutreachMode.OUTREACH,
  );

  /**
   * How many of these are done with.
   *
   * "Supplied" is the common case but not the only one: a checklist line the
   * admin marked as not applying to this job is finished too, and counting it
   * as outstanding leaves a progress bar that can never fill and a card that
   * always looks unfinished.
   */
  const countSupplied = (
    documents: (ComplianceDocumentWithFiles | undefined)[],
  ) =>
    documents.filter(
      (document) =>
        document &&
        (document.files.length > 0 || isNotRequired(document.status)),
    ).length;

  /**
   * Whether the send has to come back after the engagement left collection.
   *
   * Replacing a required document then leaves the certifier reading a
   * superseded file, with nothing on the tab to say so and no way to put it
   * right — the send disappeared the moment the outreach went. This brings it
   * back for exactly that case, and it clears itself once the replacement has
   * been sent.
   *
   * Bounded at the checklist. Beyond it the pack is not a step the engagement
   * still has, and the button was reappearing over a live review — offering to
   * re-run the collection send while the certifier was working through their
   * own checklist.
   */
  const hasUnsentRequired =
    !collecting && canSendRequiredPack(engagement) && unsentRequired.length > 0;

  /**
   * Why the pack must not go, though every row on it is full.
   *
   * Two conditions, and neither is about a missing document — the rows already
   * say what is missing. A title search naming the previous owners is the wrong
   * document rather than a late one, and plans the client has not signed off on
   * are a design that is about to change. Sending on either costs a certifier's
   * assessment of something that is not the job.
   *
   * The same function the send route refuses with, so the sentence under the
   * button is the sentence the server would have thrown.
   */
  const packBlocked = packSendBlockedReason(engagement);
  const responseDocuments = [
    ...CERTIFIER_RESPONSE_DOCUMENTS.map((response) =>
      documentsByType.get(response.type),
    ),
    ...signedCopies.map((signed) => signed.document),
  ];

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------
          Header — what this section is, and the one control that is not
          tied to a single block.
      --------------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-base font-medium text-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Compliance and certification
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Open a block to work on it. Everything collected stays in the vault.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsThreadOpen(true)}
        >
          <MessagesSquare className="size-4" aria-hidden="true" />
          Show threads
          {threadMessageCount > 0 ? (
            <Badge variant="secondary">{threadMessageCount}</Badge>
          ) : null}
        </Button>
      </div>

      {/* ---------------------------------------------------------------
          What has been raised on this file.

          Above the blocks rather than inside one, because that is the shape of
          what these do: a stale title search is about the surveyor's section
          and a DA requirement removes a row from the council's, so filing
          either under a single block would hide it from the section it
          actually changes.
      --------------------------------------------------------------- */}
      <ComplianceAlertsPanel
        alerts={alerts}
        onResolve={handleResolveAlert}
        // Only when there is a surveyor thread to send it down. A file whose
        // surveyor documents the client supplied has nobody to chase, and a
        // button that can only fail is worse than no button.
        onFollowUp={canChaseSurveyor ? handleRequestTitleSearch : undefined}
        isBusy={(alertId) => isScopeBusy(complianceScope.alert(alertId))}
      />

      {/* ---------------------------------------------------------------
          The document blocks, on a recessed panel.

          Cards on the page background read as unrelated objects floating in
          space; a tinted, bordered surface behind them is what makes the set
          look like one thing with parts. The send bar and the vault sit on it
          too, for the same reason.
      --------------------------------------------------------------- */}
      <div className="space-y-4 rounded-xl border border-border/70 bg-muted/40 p-4">
        {/* -------------------------------------------------------------
            Two columns, and the checklist across both.

            The three blocks are not the same size or the same weight. The
            pack and the certifier's reply are six rows and four, and they
            answer each other — collected here, came back there — so they sit
            side by side. The checklist is the long one: twenty items, each
            with its own requirements and references to open, and squeezed
            into a third of the width every one of those wrapped to four
            lines. It gets the full row.
        ------------------------------------------------------------- */}
        <div className="grid items-start gap-4 md:grid-cols-2">
          {/* Unidentified attachments.
              The one block that is genuinely conditional: it is not a stage
              the engagement passes through but a queue that is normally
              empty, so there is nothing here to lock or to look forward to.
              Full width and first, because nothing after it can be trusted
              while something is sitting unplaced. */}
          {unidentified.length > 0 ? (
            <ComplianceSectionCard
              title="Needs identifying"
              description="Arrived from the certifier but could not be placed."
              icon={HelpCircle}
              badge={{
                label: `${unidentified.length} to place`,
                tone: "warning",
              }}
              open={isOpen("unidentified")}
              onOpenChange={toggleSection("unidentified")}
              isActive={activeSection === "unidentified"}
              className="border-warning/40 md:col-span-2"
            >
              <ul>
                {unidentified.map((document) => (
                  <li
                    key={document.id}
                    className="space-y-2 border-b border-border/70 py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      {document.files.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => handlePreviewFile(file.id)}
                          className="block max-w-full truncate text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {file.filename}
                        </button>
                      ))}
                    </div>
                    <Select
                      disabled={isScopeBusy(scopeOf(document))}
                      onValueChange={(value) =>
                        void handleIdentify(
                          document.id,
                          value as ComplianceDocumentType,
                        )
                      }
                    >
                      <SelectTrigger className="w-full sm:max-w-xs" size="sm">
                        <SelectValue placeholder="What is this?" />
                      </SelectTrigger>
                      <SelectContent>
                        {CERTIFIER_RESPONSE_DOCUMENTS.map((response) => (
                          <SelectItem key={response.type} value={response.type}>
                            {response.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            </ComplianceSectionCard>
          ) : null}

          {/* -----------------------------------------------------------
              The required pack, one block per supplier.

              Across both columns and stacked three-up, because they are a
              sequence rather than a set: the surveyor's block feeds the two
              beside it, and reading them left to right is reading the order
              the job is actually assembled in.
          ----------------------------------------------------------- */}
          <div className="grid gap-4 md:col-span-2 lg:grid-cols-3">
            {partySections.map((entry) => (
              <PartyDocumentSection
                key={entry.party}
                section={entry.section}
                outreach={entry.outreach}
                types={entry.types}
                documents={entry.documents}
                blockedReason={blockedReason(entry.party)}
                isActive={activeSection === entry.party}
                open={isOpen(entry.party)}
                onOpenChange={toggleSection(entry.party)}
                progress={{
                  done: countSupplied(entry.documents),
                  total: entry.types.length,
                }}
                isBusy={isScopeBusy(complianceScope.party(entry.party))}
                rowMode={rowMode}
                isRowBusy={(document, documentType) =>
                  isScopeBusy(scopeOf(document, documentType))
                }
                onConnect={() => handleConnectParty(entry.party)}
                onSelfSupplied={() => void handleSelfSupplied(entry.party)}
                onUpload={(file, target) => void attachEvidence(file, target)}
                onPreviewFile={handlePreviewFile}
                projectId={project.id}
                planningCertificate={engagement.planningCertificate}
                architectWorkflow={
                  entry.party === CompliancePartyType.ARCHITECT ? (
                    <ArchitectWorkflow
                      projectId={project.id}
                      outreach={entry.outreach}
                      hasPreliminaryPlans={Boolean(
                        documentsByType.get(
                          ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
                        )?.files.length,
                      )}
                    />
                  ) : null
                }
              />
            ))}
          </div>

          {/* -----------------------------------------------------------
              Sending the pack.

              Its own bar rather than a footer on one of the three blocks
              above: the send carries all six documents, so hanging it off
              the surveyor's card would have made it look like the
              surveyor's, and repeating it on each would have offered the
              same send three times.
          ----------------------------------------------------------- */}
          {collecting || hasUnsentRequired ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-background px-4 py-3 md:col-span-2">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "certifierDiscovery",
                      payload: { projectId: project.id },
                    }),
                  )
                }
                disabled={requiredPackBusy || packBlocked !== null}
              >
                {collecting
                  ? "Find and send documents"
                  : "Send updated documents"}
              </Button>
              {/* Why the send is refused, where it is. Above the replacement
                  note because it is the stronger condition: a pack that must
                  not go at all is not usefully described as out of date.

                  The same sentence the server would throw, read off the same
                  function, so a button that refuses and a request that refuses
                  cannot give two accounts of one condition. */}
              {packBlocked ? (
                <p className="text-xs text-warning-ink">{packBlocked}</p>
              ) : null}
              {/* The one thing the rows themselves cannot say: the file on
                  them is current, and the certifier's copy is not. */}
              {!collecting ? (
                <p className="text-xs text-muted-foreground">
                  A document has been replaced since the pack was sent — the
                  certifier still has the old copy.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Certifier response.

              Full width, like everything else on this panel. It sat in one
              column of a two-column grid whose other half nothing ever filled,
              so the card rendered at half the width of the blocks above and
              below it with a column of empty space beside it. */}
          <ComplianceSectionCard
            className="md:col-span-2"
            title="Certifier response"
            description="Upload the signed copies to unlock the checklist."
            icon={Inbox}
            progress={{
              done: countSupplied(responseDocuments),
              total: responseDocuments.length,
            }}
            open={isOpen("response")}
            onOpenChange={toggleSection("response")}
            isActive={activeSection === "response"}
            locked={responseLocked}
            lockMessage="Send the required pack. The certifier's reply — and the forms to sign — land here."
            footer={
              // Nothing left to ask for. The extraction has already run —
              // that is what moved the engagement here — so the button would
              // re-run it over a checklist that exists, and both notes under
              // it are about waiting for a reply that has arrived.
              inChecklistStage ? null : (
                <div className="space-y-2">
                  <Button
                    type="button"
                    className="w-full"
                    disabled={
                      !signedCopiesSent ||
                      !checklistDocument ||
                      checklistRequestBusy
                    }
                    onClick={() =>
                      dispatch(
                        openModal({
                          type: "certifierExtract",
                          payload: {
                            projectId: project.id,
                            engagementId: engagement.id,
                            documentId: checklistDocument?.id,
                          },
                        }),
                      )
                    }
                  >
                    Get Checklist
                  </Button>
                  {!signedCopiesSent ? (
                    <p className="text-xs text-muted-foreground">
                      Upload both signed copies — they go to the certifier
                      automatically.
                    </p>
                  ) : !checklistDocument ? (
                    <p className="text-xs text-muted-foreground">
                      Waiting on the certifier&apos;s checklist.
                    </p>
                  ) : null}
                </div>
              )
            }
          >
            <ul>
              {CERTIFIER_RESPONSE_DOCUMENTS.map((response) => (
                <ComplianceDocumentRow
                  key={response.type}
                  label={response.label}
                  document={documentsByType.get(response.type)}
                  helperText="Not received yet"
                  mode="frozen"
                  onPreviewFile={handlePreviewFile}
                />
              ))}

              {signedCopies.map((signed) => (
                <ComplianceDocumentRow
                  key={signed.type}
                  label={signed.label}
                  document={signed.document}
                  helperText="Please upload the signed copy"
                  mode={rowMode(signed.document)}
                  // Their own upload, and the send it triggers: the pair goes
                  // to the certifier as one act, so neither row is editable
                  // while that is happening.
                  isBusy={
                    isScopeBusy(scopeOf(signed.document, signed.type)) ||
                    isScopeBusy(complianceScope.signedCopies)
                  }
                  onUpload={(file) =>
                    void attachSignedCopy(
                      file,
                      signed.type,
                      signed.document?.id,
                    )
                  }
                  onApprove={() =>
                    signed.document && void handleApprove(signed.document)
                  }
                  onReject={() =>
                    signed.document && handleReject(signed.document)
                  }
                  onPreviewFile={handlePreviewFile}
                />
              ))}
            </ul>
          </ComplianceSectionCard>

          {/* -----------------------------------------------------------
              The checklist, or the DA that replaces it.

              Never both. Once the architect says the job needs development
              approval it is not going through as a CDC, so the certifier
              has no checklist to issue and the one on screen would be a
              block that can never fill. The DA list takes the same slot
              rather than sitting somewhere else on the page, because it is
              the same step of the job reached by the other route.
          ----------------------------------------------------------- */}
          {hasDaAlert ? (
            <DaApprovalSection className="md:col-span-2" />
          ) : (
            <ComplianceSectionCard
              title="Checklist"
              description="One document per item the certifier asked for."
              icon={ClipboardList}
              progress={{
                done: countSupplied(checklistItems),
                total: checklistItems.length,
              }}
              open={isOpen("checklist")}
              onOpenChange={toggleSection("checklist")}
              isActive={activeSection === "checklist"}
              locked={checklistLocked}
              lockMessage="Unlocks when the certifier issues their checklist — one row per item they ask for."
              // Across both columns. Each row can open its own requirements
              // and references, and at half the width every one of those
              // wrapped into a paragraph.
              className="md:col-span-2"
            >
              <ul>
                {checklistItems.map((item) => (
                  <ComplianceDocumentRow
                    key={item.id}
                    label={complianceDocumentLabel(item.documentType, item.label)}
                    document={item}
                    detail={checklistItemDetail(item.detail)}
                    helperText={
                      item.files.length ? undefined : "Not supplied yet"
                    }
                    mode={rowMode(item)}
                    isBusy={
                      isScopeBusy(
                        scopeOf(item, ComplianceDocumentType.CHECKLIST_ITEM),
                      ) || submissionClaimed
                    }
                    onUpload={(file) =>
                      void attachEvidence(file, {
                        documentId: item.id,
                        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
                      })
                    }
                    onApprove={() => void handleApprove(item)}
                    onReject={() => handleReject(item)}
                    // Offered to an admin, and only while the file is still
                    // being assembled. Once it is with the certifier the answer
                    // to "is this needed" is theirs, and it comes back as an
                    // approval or a rejection rather than as a row nobody has
                    // to fill in any more.
                    onSetNotRequired={
                      isAdmin && !inReview
                        ? (notRequired) =>
                            void handleSetNotRequired(item, notRequired)
                        : undefined
                    }
                    onPreviewFile={handlePreviewFile}
                  />
                ))}
              </ul>

              {/* -------------------------------------------------------
                  Home insurance
              ------------------------------------------------------- */}
              {allChecklistUploaded ? (
                <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 p-4">
                  {insuranceDocument?.files.length ? (
                    <ul>
                      <ComplianceDocumentRow
                        label="Home Insurance"
                        document={insuranceDocument}
                        mode={rowMode(insuranceDocument)}
                        isBusy={isScopeBusy(insuranceScope) || submissionClaimed}
                        onUpload={(file) =>
                          void attachEvidence(file, insuranceUpload)
                        }
                        onApprove={() => void handleApprove(insuranceDocument)}
                        onReject={() => handleReject(insuranceDocument)}
                        onPreviewFile={handlePreviewFile}
                      />
                    </ul>
                  ) : (
                    <>
                      <p className="font-medium text-foreground">
                        Have you raised the home insurance?
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          variant={
                            insuranceAnswer === "yes" ? "default" : "outline"
                          }
                          size="sm"
                          onClick={() => setInsuranceAnswer("yes")}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={
                            insuranceAnswer === "no" ? "default" : "outline"
                          }
                          size="sm"
                          onClick={() => setInsuranceAnswer("no")}
                        >
                          No
                        </Button>
                      </div>

                      {insuranceAnswer === "yes" ? (
                        <ul className="mt-2">
                          <ComplianceDocumentRow
                            label="Home Insurance"
                            helperText="Upload the certificate of insurance"
                            mode="upload"
                            isBusy={
                              isScopeBusy(insuranceScope) || submissionClaimed
                            }
                            onUpload={(file) =>
                              void attachEvidence(file, insuranceUpload)
                            }
                          />
                        </ul>
                      ) : null}

                      {insuranceAnswer === "no" ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Raise Home Building Compensation Fund cover with icare,
                          then come back and upload the certificate.{" "}
                          <a
                            href={HBCF_INSURANCE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          >
                            icare HBCF
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </ComplianceSectionCard>
          )}
        </div>

        {/* -------------------------------------------------------------
            Send for review — the one send that puts the file with the
            certifier. On offer while the collection is still open, and
            gone the moment it has happened.

            Full width and outside the grid on purpose: it is the one
            action that closes the whole engagement, so it must not sit
            inside a card that happens to be collapsed.
        ------------------------------------------------------------- */}
        {allEvidenceIn ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success-light px-4 py-3">
            <p className="flex-1 font-medium text-foreground">
              Compliance and Certification complete
            </p>
            <Button
              type="button"
              disabled={reviewBusy}
              onClick={() =>
                dispatch(
                  openModal({
                    type: "complianceComplete",
                    payload: {
                      projectId: project.id,
                      documentCount: submissionDocuments.length,
                    },
                  }),
                )
              }
            >
              {submissionClaimed ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Send it to Certifier
            </Button>
          </div>
        ) : null}

        {inReview && !isAdmin ? (
          <p className="text-sm text-muted-foreground">
            With the certifier for review. An admin approves or rejects each
            document as it comes back.
          </p>
        ) : null}

        <ComplianceDocumentVault
          documents={engagement.documents}
          open={isOpen("vault")}
          onOpenChange={toggleSection("vault")}
        />
      </div>

      <ComplianceThreadsModal
        open={isThreadOpen}
        onClose={() => setIsThreadOpen(false)}
        projectId={project.id}
        certifierEmails={engagement.emails}
        isSendingToCertifier={isScopeBusy(complianceScope.reply)}
        onSendToCertifier={handleReply}
        outreaches={engagement.outreaches}
        isSendingToParty={(outreachId) =>
          isScopeBusy(complianceScope.partyReply(outreachId))
        }
        onSendToParty={handlePartyReply}
      />
    </div>
  );
}
