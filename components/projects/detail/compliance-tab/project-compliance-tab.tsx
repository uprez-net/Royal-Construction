"use client";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import {
  ClipboardList,
  ExternalLink,
  FileText,
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
  complianceDocumentLabel,
  HBCF_INSURANCE_URL,
  isApprovableDocumentType,
  isRequiredDocumentType,
  isReviewSubmissionType,
  isSignedCopyType,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import {
  canSendRequiredPack,
  hasReachedChecklistStage,
  hasSentRequiredPack,
  isRequiredPackComplete,
  unsentRequiredDocuments,
} from "@/lib/compliance/required-pack";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  complianceScope,
  identifyComplianceDocument,
  resolveComplianceDocument,
  selectComplianceMutations,
  sendCertifierReply,
  uploadComplianceDocument,
  type ComplianceScope,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";
import type {
  CertifierEngagementDetail,
  ComplianceDocumentWithFiles,
} from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";
import { CertifierThreadModal } from "./certifier-thread-modal";
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
 * Statuses `sendComplianceForReview` will leave, mirrored from the server.
 *
 * The send is guarded on that transition, so prompting for it outside this set
 * offers a button whose only possible outcome is an error toast.
 */
const READY_FOR_REVIEW_STATUSES: ReadonlySet<CertifierEngagementStatus> =
  new Set([
    CertifierEngagementStatus.CHECKLIST_TRACKING,
    CertifierEngagementStatus.INSURANCE,
    CertifierEngagementStatus.IN_REVIEW,
  ]);

/** The checklist evidence and the insurance certificate — what the send carries. */
const reviewSubmission = (engagement: CertifierEngagementDetail) =>
  engagement.documents.filter((document) =>
    isReviewSubmissionType(document.documentType),
  );

/**
 * Whether the collection phase is actually finished.
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

  return (
    hasChecklist &&
    submission.every((document) => document.files.length > 0)
  );
}

/** The collapsible blocks the tab is built from, in flow order. */
type SectionKey =
  | "required"
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
  // The finished file sits behind one more click, so returning to the tab after
  // approval shows that the job is closed rather than dropping straight into a
  // document index.
  const [showFinalPage, setShowFinalPage] = useState(false);
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  /**
   * Which blocks the reader has opened or shut by hand.
   *
   * Sparse on purpose: anything absent falls back to the active section, so
   * a card left alone keeps following the flow as the engagement moves on,
   * while one that was clicked stays where it was put.
   */
  const [sections, setSections] = useState<Partial<Record<SectionKey, boolean>>>(
    {},
  );

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
  // Only the checklist evidence is ever approved, so it alone decides whether
  // the engagement is finished. Measuring this against every supplied document
  // left it permanently short, on rows with no approve control to press.
  const allApproved =
    checklistItems.length > 0 &&
    checklistItems.every(
      (document) => document.status === ComplianceDocumentStatus.APPROVED,
    );

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
          documentCount: REQUIRED_COMPLIANCE_DOCUMENTS.length,
          updatedCount: outstanding.length,
          isResend: hasSentRequiredPack(next),
        },
      }),
    );
  };

  /**
   * Opens the completion prompt when the set has just become whole.
   *
   * Called with the engagement the server returned rather than from an effect,
   * so the decision is made against what was actually written instead of a
   * render that may not have happened yet.
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

    // Already signed off. Re-uploading against an approved engagement is not a
    // reason to ask whether to send it for approval again. Read off the
    // checklist alone, because that is the only part anybody approves.
    const closed = next.documents
      .filter((document) => isApprovableDocumentType(document.documentType))
      .every(
        (document) => document.status === ComplianceDocumentStatus.APPROVED,
      );
    if (closed) return;

    dispatch(
      openModal({
        type: "complianceComplete",
        payload: {
          projectId: project.id,
          documentCount: reviewSubmission(next).length,
          // Re-supplying after a rejection round reads differently from
          // finishing the collection for the first time.
          isResend: next.status === CertifierEngagementStatus.IN_REVIEW,
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
        error instanceof Error ? error.message : `Could not upload ${file.name}.`,
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
        error instanceof Error ? error.message : "Could not approve the document.",
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
        error instanceof Error ? error.message : "Could not identify the document.",
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
  // Everything approved — the section is closed, and the finished file is one
  // click behind it.
  // ---------------------------------------------------------------------

  if (engagement.status === CertifierEngagementStatus.APPROVED) {
    if (showFinalPage) {
      return <ComplianceFinalPage documents={engagement.documents} />;
    }

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck
                className="size-4 text-success-ink"
                aria-hidden="true"
              />
              Compliance and Certification complete
            </CardTitle>
            <CardDescription>
              The certifier has approved all {checklistItems.length} checklist
              items. Nothing in this section can change now.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setShowFinalPage(true)}>
              View final document list
            </Button>
            {/* The conversation outlives the engagement — it is the record of
                how the approval was reached. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsThreadOpen(true)}
            >
              <MessagesSquare className="size-4" aria-hidden="true" />
              Show certifier thread
            </Button>
          </CardContent>
        </Card>

        <CertifierThreadModal
          open={isThreadOpen}
          onClose={() => setIsThreadOpen(false)}
          projectId={project.id}
          emails={engagement.emails}
          isSending={isScopeBusy(complianceScope.reply)}
          onSend={handleReply}
        />
      </>
    );
  }

  const collecting =
    engagement.status === CertifierEngagementStatus.NOT_STARTED ||
    engagement.status === CertifierEngagementStatus.COLLECTING_DOCS;

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

  const checklistDocument = documentsByType.get(ComplianceDocumentType.CHECKLIST);
  const allChecklistUploaded =
    checklistItems.length > 0 &&
    checklistItems.every((item) => item.files.length > 0);
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
  // What each send is blocked by.
  //
  // A send is not just its own request: it carries a set of documents, and
  // posting that set while one of them is halfway through being replaced sends
  // the certifier something nobody meant to send. So each send is gated on its
  // own scope plus the scopes of everything it carries — and on nothing else,
  // which is the point. Work in one block no longer stops work in another.
  // -------------------------------------------------------------------
  const requiredScopes = REQUIRED_COMPLIANCE_DOCUMENTS.map((required) =>
    scopeOf(documentsByType.get(required.type), required.type),
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
          : "required";

  const isOpen = (key: SectionKey) => sections[key] ?? key === activeSection;
  const toggleSection = (key: SectionKey) => (open: boolean) =>
    setSections((current) => ({ ...current, [key]: open }));

  const countSupplied = (
    documents: (ComplianceDocumentWithFiles | undefined)[],
  ) => documents.filter((document) => (document?.files.length ?? 0) > 0).length;

  const requiredDocuments = REQUIRED_COMPLIANCE_DOCUMENTS.map((required) =>
    documentsByType.get(required.type),
  );

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
          Show certifier thread
          {engagement.emails.length > 0 ? (
            <Badge variant="secondary">{engagement.emails.length}</Badge>
          ) : null}
        </Button>
      </div>

      {/* ---------------------------------------------------------------
          The document blocks, on a recessed panel.

          Cards on the page background read as unrelated objects floating in
          space; a tinted, bordered surface behind them is what makes the set
          look like one thing with parts. The send bar and the vault sit on it
          too, for the same reason.
      --------------------------------------------------------------- */}
      <div className="space-y-4 rounded-xl border border-border/70 bg-muted/40 p-4">
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Required documents */}
          <ComplianceSectionCard
            title="Required documents"
            description="The pack that goes to the certifier."
            icon={FileText}
            progress={{
              done: countSupplied(requiredDocuments),
              total: REQUIRED_COMPLIANCE_DOCUMENTS.length,
            }}
            open={isOpen("required")}
            onOpenChange={toggleSection("required")}
            isActive={activeSection === "required"}
            footer={
              collecting || hasUnsentRequired ? (
                <div className="space-y-2">
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() =>
                      dispatch(
                        openModal({
                          type: "certifierDiscovery",
                          payload: { projectId: project.id },
                        }),
                      )
                    }
                    disabled={requiredPackBusy}
                  >
                    {collecting
                      ? "Find and send documents"
                      : "Send updated documents"}
                  </Button>
                  {/* The one thing the row itself cannot say: the file on it
                      is current, and the certifier's copy is not. */}
                  {!collecting ? (
                    <p className="text-xs text-muted-foreground">
                      A document has been replaced since the pack was sent — the
                      certifier still has the old copy.
                    </p>
                  ) : null}
                </div>
              ) : null
            }
          >
            <ul>
              {REQUIRED_COMPLIANCE_DOCUMENTS.map((required) => {
                const document = documentsByType.get(required.type);
                return (
                  <ComplianceDocumentRow
                    key={required.type}
                    label={required.label}
                    document={document}
                    helperText={
                      document?.files.length ? undefined : "Not collected yet"
                    }
                    mode={rowMode(document)}
                    isBusy={isScopeBusy(scopeOf(document, required.type))}
                    onUpload={(file) =>
                      void attachEvidence(file, {
                        documentId: document?.id,
                        documentType: required.type,
                      })
                    }
                    onApprove={() =>
                      document && void handleApprove(document)
                    }
                    onReject={() =>
                      document && handleReject(document)
                    }
                    onPreviewFile={handlePreviewFile}
                  />
                );
              })}
            </ul>
          </ComplianceSectionCard>

          {/* Unidentified attachments */}
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
              className="border-warning/40"
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
                      <SelectTrigger className="w-full" size="sm">
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

          {/* Certifier response */}
          {hasResponse ? (
            <ComplianceSectionCard
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
                      signed.document &&
                      void handleApprove(signed.document)
                    }
                    onReject={() =>
                      signed.document &&
                      handleReject(signed.document)
                    }
                    onPreviewFile={handlePreviewFile}
                  />
                ))}
              </ul>
            </ComplianceSectionCard>
          ) : null}

          {/* Checklist */}
          {checklistItems.length > 0 ? (
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
            >
              <ul>
                {checklistItems.map((item) => (
                  <ComplianceDocumentRow
                    key={item.id}
                    label={complianceDocumentLabel(
                      item.documentType,
                      item.label,
                    )}
                    document={item}
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
                        onApprove={() =>
                          void handleApprove(insuranceDocument)
                        }
                        onReject={() =>
                          handleReject(insuranceDocument)
                        }
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
                          Raise Home Building Compensation Fund cover with
                          icare, then come back and upload the certificate.{" "}
                          <a
                            href={HBCF_INSURANCE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          >
                            icare HBCF
                            <ExternalLink
                              className="size-3"
                              aria-hidden="true"
                            />
                          </a>
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </ComplianceSectionCard>
          ) : null}
        </div>

        {/* -------------------------------------------------------------
            Send for review — the first send and every re-send after a
            round of rejections, which is what lets the loop finish.

            Full width and outside the grid on purpose: it is the one
            action that closes the whole engagement, so it must not sit
            inside a card that happens to be collapsed.
        ------------------------------------------------------------- */}
        {allEvidenceIn && !allApproved ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success-light px-4 py-3">
            <p className="flex-1 font-medium text-foreground">
              {inReview
                ? "Everything sent back has been re-supplied"
                : "Compliance and Certification complete"}
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
                      isResend: inReview,
                    },
                  }),
                )
              }
            >
              {submissionClaimed ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {inReview ? "Re-send to Certifier" : "Send it to Certifier"}
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

      <CertifierThreadModal
        open={isThreadOpen}
        onClose={() => setIsThreadOpen(false)}
        projectId={project.id}
        emails={engagement.emails}
        isSending={isScopeBusy(complianceScope.reply)}
        onSend={handleReply}
      />
    </div>
  );
}
