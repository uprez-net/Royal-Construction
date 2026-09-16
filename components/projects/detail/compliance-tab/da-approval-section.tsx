"use client";

import {
  ComplianceAlertSource,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";
import { ExternalLink, FileStack, Send } from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  complianceDocumentLabel,
  DA_DOCUMENT_GROUPS,
  EXTERNAL_APPLICATION_COPY,
  isNotRequired,
  OWNER_CONSENT_FORM_URL,
  type DaDocument,
} from "@/constants/complianceDocuments";
import {
  checklistItemDetail,
  externalApplicationStep,
  type ComplianceDocumentWithFiles,
  type ComplianceExternalApplicationRecord,
} from "@/types/compliance";
import { dateFormat } from "@/utils/formatters";

import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceSectionCard } from "./compliance-section-card";
import { ExternalApplicationBlock } from "./external-application-block";

/**
 * The development application, once the job stops being a CDC.
 *
 * This block was a placeholder for one release, and the note it carried was
 * honest about why: most of the documents flow in from the required pack and
 * are read-only here, and the council's own extra requirements had not been
 * pinned down. They have been now, and they turn out to be very nearly what the
 * certifier's checklist already asks for — a DA and a CDC are two ways of
 * assessing the same house against the same instruments, so the structural
 * drawings, the water approvals and the levy receipt are the same documents by
 * either route.
 *
 * That is why this list is assembled out of the same types, the same consultant
 * parties and the same application blocks as the checklist, rather than being a
 * second document system that happens to look similar. The differences are the
 * two forms at the end, which a certifier never asks for and a council always
 * does, and the lodgement at the bottom.
 *
 * Three kinds of row, and they behave differently on purpose:
 *
 *  - Carried over from the pack. Read-only here, because a plan that can be
 *    replaced in two places is a plan two people can disagree about. The pack
 *    section above stays the one place any of them changes.
 *  - Produced here. The build cost summary and the owner consent form, both
 *    uploaded by the builder — the second after being downloaded, signed and
 *    scanned, which is why its row carries a link as well as a button.
 *  - Obtained from somebody else. The consultant and portal controls the
 *    checklist rows already use, rendered by the caller for the same reason
 *    they are there: this component knows what a document is and nothing about
 *    who produces one.
 */

type DaApprovalSectionProps = {
  projectId: string;
  /** Every document row on the file, by type, resolved by the caller. */
  documentsByType: Map<ComplianceDocumentType, ComplianceDocumentWithFiles>;
  /** The DA lodgement itself. Null until somebody records one. */
  application: ComplianceExternalApplicationRecord | null;
  /** The 10.7, the road opening permit, the levy and the subsidence approval. */
  applicationFor: (
    kind: ComplianceExternalApplicationKind,
  ) => ComplianceExternalApplicationRecord | null;
  /** How each row gets what it needs — a consultant, a portal, an architect. */
  renderAction: (document: DaDocument) => ReactNode;
  rowMode: (
    document?: ComplianceDocumentWithFiles,
  ) => "upload" | "resolve" | "frozen";
  isRowBusy: (
    document: ComplianceDocumentWithFiles | undefined,
    documentType: ComplianceDocumentType,
  ) => boolean;
  /**
   * Whether one row is past what whoever was asked for it quoted.
   *
   * The same shape and the same reason as `isRowBusy`: the answer needs the
   * outreach that asked and the alert the nightly sweep raised, neither of
   * which a list of rows can see.
   */
  isRowOverdue?: (
    document: ComplianceDocumentWithFiles | undefined,
    documentType: ComplianceDocumentType,
  ) => boolean;
  onUpload: (
    file: File,
    target: { documentId?: string; documentType: ComplianceDocumentType },
  ) => void;
  onSetNotRequired?: (
    document: ComplianceDocumentWithFiles,
    notRequired: boolean,
  ) => void;
  onPreviewFile: (fileId: string) => void;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  /**
   * The estate developer's sign-off, rendered by the caller.
   *
   * A slot rather than something built here, for the reason `renderAction` is
   * one: this component knows what a document is and nothing about who
   * produces one — and the developer block needs an outreach, three dispatches
   * and two modals, none of which belong in a list of rows.
   *
   * It sits beside the lodgement rather than among the documents because it is
   * not one. Nothing is being collected: it is a condition on sending, like the
   * bushfire row being answered, and both are what `blockedReason` below reads.
   */
  developerBlock?: ReactNode;
  /**
   * What the council has asked for since the application was lodged.
   *
   * Its own list rather than more rows in the groups above, because it is a
   * different kind of thing and behaves differently. The groups are what a DA
   * always needs, known before anything is sent; these are what this council
   * asked this job for afterwards, in their own words, and the list grows every
   * time they write. Folding them together would mean a fixed list whose length
   * changed, and a reader could no longer tell what was standard from what was
   * this council's own.
   */
  daItems?: readonly ComplianceDocumentWithFiles[];
  /** Sends one back — the council refused it, or an admin is recording that. */
  onRejectItem?: (document: ComplianceDocumentWithFiles) => void;
  onApproveItem?: (document: ComplianceDocumentWithFiles) => void;
  /** Where somebody records that the pack went back in. */
  onResubmit?: () => void;
  /**
   * Why the application cannot be lodged yet, beyond outstanding documents.
   *
   * Null when the only thing missing is rows, which the block already says for
   * itself. Set when every row is answered and the pack still must not go — the
   * shape `packSendBlockedReason` uses on the certifier's own send, and for the
   * same reason: a grey button with no sentence beside it is a bug report.
   */
  blockedReason?: string | null;
};

export function DaApprovalSection({
  projectId,
  documentsByType,
  application,
  applicationFor,
  renderAction,
  rowMode,
  isRowBusy,
  isRowOverdue,
  onUpload,
  onSetNotRequired,
  onPreviewFile,
  isActive,
  open,
  onOpenChange,
  className,
  developerBlock,
  blockedReason,
  daItems = [],
  onRejectItem,
  onApproveItem,
  onResubmit,
}: DaApprovalSectionProps) {
  /**
   * Whether a row is answered.
   *
   * "Supplied" is the common case and not the only one: a row the admin has
   * marked as not applying to this job is finished too, and mine subsidence is
   * marked that way on almost every job — the districts it covers are a small
   * part of the state, and a list that could never fill is a list nobody reads.
   */
  const isSettled = (document: DaDocument) => {
    const row = documentsByType.get(document.type);
    if (!row) return false;
    return row.files.length > 0 || isNotRequired(row.status);
  };

  const outstanding = DA_DOCUMENTS_FLAT.filter(
    (document) => !isSettled(document),
  );

  /**
   * The council's answer, where it has come.
   *
   * Deliberately not one of the rows above. Those are what the application
   * needs; this is what it produced, and counting it among them would mean the
   * list could never be complete until after it had been submitted.
   */
  const consent = documentsByType.get(
    ComplianceDocumentType.DEVELOPMENT_CONSENT,
  );
  const done = DA_DOCUMENTS_FLAT.length - outstanding.length;
  const step = externalApplicationStep(application);

  /**
   * Whether the council has decided and the notice is still not on the file.
   *
   * Read off the step rather than off `approvalNotifiedAt` directly, so this and
   * the panel below it cannot disagree about what "determined" means — see
   * `externalApplicationStep`, where the state sits between `lodged` and
   * `received` precisely so it can be told apart from both.
   *
   * Narrowed to the consent being absent, because a file that has downloaded it has
   * nothing left to be prompted about and the row above says so.
   */
  const awaitingConsentDownload =
    step === "determined" && !consent?.files.length;

  /**
   * Whether the pack is complete enough to lodge.
   *
   * Every row answered, one way or the other. Deliberately not "every row has a
   * file": the council does not want a mine subsidence approval for a lot that
   * is not in a subsidence district, and an admin saying so is an answer.
   */
  const isReadyToLodge = outstanding.length === 0 && !blockedReason;

  return (
    <ComplianceSectionCard
      title="Development application"
      description="What the council needs, and what has already been collected for it."
      icon={FileStack}
      progress={{ done, total: DA_DOCUMENTS_FLAT.length }}
      open={open}
      onOpenChange={onOpenChange}
      isActive={isActive}
      // Anything on this list somebody is late with, carry-overs excluded --
      // those are the pack's rows and are chased on the pack's own block.
      overdue={
        DA_DOCUMENTS_FLAT.some(
          (entry) =>
            entry.source !== "pack" &&
            (isRowOverdue?.(documentsByType.get(entry.type), entry.type) ??
              false),
        ) ||
        daItems.some(
          (item) => isRowOverdue?.(item, item.documentType) ?? false,
        )
      }
      // Determined, and the notice is still on the portal.
      //
      // The same state the certificate block renders green for, and it reaches the
      // DA for the same reason: a council determines the application and emails to
      // say so without attaching the notice of determination. The consent is what
      // unfreezes the certifier's checklist, so a file sitting in this state is the
      // whole rest of the job waiting on one download.
      ready={awaitingConsentDownload}
      readyLabel="Consent ready to download"
      className={className}
    >
      {DA_DOCUMENT_GROUPS.map((group) => (
        <section key={group.heading} className="mt-4 first:mt-0">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.heading}
          </h4>

          <ul>
            {group.documents.map((entry) => {
              const row = documentsByType.get(entry.type);

              return (
                <ComplianceDocumentRow
                  key={entry.type}
                  label={complianceDocumentLabel(entry.type)}
                  document={row}
                  helperText={row?.files.length ? undefined : entry.helper}
                  // The carry-overs are frozen whatever their own status says.
                  // They are the pack's documents, shown here so the reader can
                  // see the DA is not waiting on them; the pack is where any of
                  // them is replaced.
                  mode={entry.source === "pack" ? "frozen" : rowMode(row)}
                  isBusy={isRowBusy(row, entry.type)}
                  // Never on a carry-over. Those rows are the pack's, chased on
                  // the pack's own block, and a badge in two places is two
                  // people going after the same firm.
                  overdue={
                    entry.source !== "pack" &&
                    (isRowOverdue?.(row, entry.type) ?? false)
                  }
                  onUpload={(file) =>
                    onUpload(file, {
                      documentId: row?.id,
                      documentType: entry.type,
                    })
                  }
                  // Every DA row can be waived when it does not apply to this
                  // job. Carry-over rows stay frozen for file replacement, but
                  // marking the DA requirement as not required is a separate
                  // decision and must remain available here.
                  onSetNotRequired={
                    row && onSetNotRequired
                      ? (notRequired) => onSetNotRequired(row, notRequired)
                      : undefined
                  }
                  onPreviewFile={onPreviewFile}
                  mappedFrom={
                    entry.source === "pack" ? "the documents above" : undefined
                  }
                  consultantAction={
                    entry.type === ComplianceDocumentType.OWNER_CONSENT_FORM &&
                    !row?.files.length ? (
                      // The one row whose action is a download rather than a
                      // request. The council will only accept its own wording,
                      // so the form is fetched, signed by every registered
                      // owner, and uploaded back.
                      <Button asChild type="button" variant="ghost" size="sm">
                        <a
                          href={OWNER_CONSENT_FORM_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Get the form
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      </Button>
                    ) : (
                      renderAction(entry)
                    )
                  }
                />
              );
            })}
          </ul>
        </section>
      ))}

      {/* -------------------------------------------------------------
          What the council has come back and asked for.

          Below the fixed groups and above the lodgement, which is where it
          belongs in both senses: it exists only after the application has gone
          in, and every one of these has to be answered before it can go in
          again. Rendered only when there are any — on a job the council has
          not written to, an empty "further requests" heading is a question a
          reader has to answer for themselves.
      ------------------------------------------------------------- */}
      {daItems.length > 0 ? (
        <section className="mt-4">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Requested by the council
          </h4>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Read off their emails as they arrive. Each one is worded the way
            they worded it.
          </p>

          <ul>
            {daItems.map((item) => (
              <ComplianceDocumentRow
                key={item.id}
                label={complianceDocumentLabel(item.documentType, item.label)}
                document={item}
                detail={checklistItemDetail(item.detail)}
                helperText="Not supplied yet"
                mode={rowMode(item)}
                isBusy={isRowBusy(item, item.documentType)}
                overdue={isRowOverdue?.(item, item.documentType) ?? false}
                onUpload={(file) =>
                  onUpload(file, {
                    documentId: item.id,
                    documentType: item.documentType,
                  })
                }
                onApprove={onApproveItem ? () => onApproveItem(item) : undefined}
                onReject={onRejectItem ? () => onRejectItem(item) : undefined}
                onSetNotRequired={
                  onSetNotRequired
                    ? (notRequired) => onSetNotRequired(item, notRequired)
                    : undefined
                }
                onPreviewFile={onPreviewFile}
                rejectedBy={rejectedByLabel(item)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------------------
          Lodging it.

          Below every group and outside them, because it is the one action that
          is about the application rather than about a document — and because a
          reader scrolling a twenty-row list needs the thing they are working
          towards to be at the end of it rather than tucked inside a group.
      ------------------------------------------------------------- */}
      <div className="mt-5 rounded-lg border border-border/70 bg-background px-4 py-3">
        {isReadyToLodge || step !== "unanswered" ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* Read off the step, like the pill beside it. This panel renders
                  from "ready to lodge" all the way through to determination,
                  and a fixed heading told an admin the application still needed
                  submitting while the pill next to it read "Determined". */}
              <p className="font-medium text-foreground">
                {step === "received"
                  ? "The council has determined this application"
                  : step === "lodged"
                    ? "Lodged with the council"
                    : "Ready to submit the application"}
              </p>
              {step === "received" ? (
                <StatusPill tone="success">Determined</StatusPill>
              ) : step === "lodged" ? (
                <StatusPill tone="neutral">With the council</StatusPill>
              ) : (
                <StatusPill tone="success">
                  {done} of {DA_DOCUMENTS_FLAT.length} collected
                </StatusPill>
              )}
            </div>
            <SubmissionRounds
              application={application}
              onResubmit={onResubmit}
              // Offered only once something has actually been lodged. A
              // resubmission of an application nobody recorded lodging is
              // somebody on the wrong control, and the server refuses it.
              canResubmit={Boolean(application?.appliedAt) && step !== "received"}
            />
            <ExternalApplicationBlock
              projectId={projectId}
              kind={ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION}
              application={application}
              // The one application whose document row is rendered inside its
              // own block rather than on the list above. The consent is not a
              // requirement of the DA, it is the answer to it — and it is the
              // document the whole rest of the tab is waiting on, so it belongs
              // where the lodgement it answers is recorded rather than filed
              // among the twenty things that had to go in first.
              documentRows={
                <ul>
                  <ComplianceDocumentRow
                    label={complianceDocumentLabel(
                      ComplianceDocumentType.DEVELOPMENT_CONSENT,
                    )}
                    document={consent}
                    helperText={
                      consent?.files.length
                        ? undefined
                        : "The council's notice of determination. Uploading it reopens the certifier's checklist."
                    }
                    mode={rowMode(consent)}
                    isBusy={isRowBusy(
                      consent,
                      ComplianceDocumentType.DEVELOPMENT_CONSENT,
                    )}
                    onUpload={(file) =>
                      onUpload(file, {
                        documentId: consent?.id,
                        documentType:
                          ComplianceDocumentType.DEVELOPMENT_CONSENT,
                      })
                    }
                    onPreviewFile={onPreviewFile}
                  />
                </ul>
              }
            />
          </>
        ) : blockedReason ? (
          // Said before the count, because it is the sharper answer. A reader
          // whose rows are all green and whose button is still grey is looking
          // for exactly this sentence, and putting the document tally first
          // would tell them the one thing they already know.
          <p className="text-sm text-muted-foreground">{blockedReason}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {outstanding.length} document
            {outstanding.length === 1 ? "" : "s"} still outstanding — the
            application can be lodged once each one is either supplied or marked
            as not applying to this job.
          </p>
        )}
      </div>

      {/* The estate developer's sign-off on the bushfire report, where the lot
          sits in an estate that wants one. Above the certificate block and
          below the lodgement, because it is a condition on lodging rather than
          a document being ordered. */}
      {developerBlock}

      {/* The 10.7 certificate, which the pack has written off and the council
          still wants. Its block lives here rather than on the pack from the
          moment the job changes path, so the certificate is ordered in exactly
          one place. */}
      <CertificateBlock
        projectId={projectId}
        application={applicationFor(
          ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
        )}
        document={documentsByType.get(
          ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
        )}
      />
    </ComplianceSectionCard>
  );
}

/**
 * Who sent a row back, as a sentence fragment the row can print.
 *
 * Null where nothing was rejected, and null where the source was never recorded
 * — which is every rejection made before the column existed, all of them the
 * certifier's. The row's own default covers that case, and returning null here
 * rather than guessing keeps the fallback in one place.
 */
function rejectedByLabel(
  document: ComplianceDocumentWithFiles,
): string | null {
  if (!document.rejectionReason) return null;
  switch (document.rejectedBySource) {
    case ComplianceAlertSource.COUNCIL:
      return "the council";
    case ComplianceAlertSource.CERTIFIER:
      return "the certifier";
    case ComplianceAlertSource.DEVELOPER:
      return "the estate developer";
    default:
      return null;
  }
}

/**
 * Every round this application has been lodged in.
 *
 * A DA that went in once needs none of this and shows none of it: one round is
 * what the lodgement block above already says. It earns its place from round
 * two, when the honest answer to "why is this still not determined" stops being
 * a date and becomes a count — and when the clock everybody is reading has
 * silently restarted from a different day.
 */
function SubmissionRounds({
  application,
  canResubmit,
  onResubmit,
}: {
  application: ComplianceExternalApplicationRecord | null;
  canResubmit: boolean;
  onResubmit?: () => void;
}) {
  const rounds = application?.submissions ?? [];

  if (!canResubmit && rounds.length <= 1) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-border/70 bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {rounds.length > 1
            ? `Lodged ${rounds.length} times`
            : "Lodgement history"}
        </p>
        {canResubmit && onResubmit ? (
          <Button type="button" variant="outline" size="sm" onClick={onResubmit}>
            <Send className="size-3.5" aria-hidden="true" />
            Record a resubmission
          </Button>
        ) : null}
      </div>

      {rounds.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {rounds.map((round) => (
            <li key={round.id} className="flex flex-wrap gap-x-2 text-sm">
              <span className="font-medium text-foreground tabular-nums">
                #{round.round}
              </span>
              <span className="text-muted-foreground">
                {dateFormat.format(new Date(round.submittedAt))}
              </span>
              {round.applicationRef ? (
                <span className="text-muted-foreground">
                  · {round.applicationRef}
                </span>
              ) : null}
              {round.note ? (
                <span className="w-full text-[13px] text-muted-foreground/80">
                  {round.note}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Record it here each time the pack goes back in — the council&apos;s
          clock restarts from the latest round, not from the first.
        </p>
      )}
    </div>
  );
}

/** Every DA row, ungrouped, for the counts. */
const DA_DOCUMENTS_FLAT = DA_DOCUMENT_GROUPS.flatMap(
  (group) => group.documents,
);

/**
 * The 10.7 block, when the certificate has not been obtained yet.
 *
 * Rendered only while it is missing, which is the case the whole arrangement
 * exists for. A job that already had the certificate when the architect said it
 * needed a DA has nothing to order and nothing to say; a job that had not is
 * one where the pack section has gone read-only, and this is now the only place
 * the certificate can be ordered from.
 */
function CertificateBlock({
  projectId,
  application,
  document,
}: {
  projectId: string;
  application: ComplianceExternalApplicationRecord | null;
  document: ComplianceDocumentWithFiles | undefined;
}) {
  if (document?.files.length) {
    return null;
  }

  const copy =
    EXTERNAL_APPLICATION_COPY[
      ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7
    ];

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 p-4">
      <p className="mb-2 font-medium text-foreground">{copy.label}</p>
      <p className="mb-3 text-xs text-muted-foreground">
        The council assesses the application against the same zoning and
        overlays the certifier would have. It is ordered from here now rather
        than from the documents above, so it is only applied for once.
      </p>
      <ExternalApplicationBlock
        projectId={projectId}
        kind={ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7}
        application={application}
        documentRows={null}
      />
    </div>
  );
}
