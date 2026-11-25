"use client";

import {
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";
import { CheckCircle2, ExternalLink, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  complianceDocumentLabel,
  EXTERNAL_APPLICATION_COPY,
} from "@/constants/complianceDocuments";
import {
  CERTIFICATE_DOCUMENT_TYPE,
  PLANNING_PORTAL_URL,
  type CertificateApplicationKind,
} from "@/lib/domain/compliance/portal-certificates";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";
import {
  complianceScope,
  recordPrincipalCertifier,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";
import type {
  ComplianceDocumentWithFiles,
  ComplianceExternalApplicationRecord,
} from "@/types/compliance";
import { dateFormat } from "@/utils/formatters";

import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceSectionCard } from "./compliance-section-card";
import { ExternalApplicationBlock } from "./external-application-block";

/**
 * The step that was missing: lodging the certificate application.
 *
 * The tab used to run the checklist straight into "Certificate and cover", on the
 * understanding that a certifier passes the last item and then issues the
 * certificate off their own desk. They do not. Passing the checklist is the
 * certifier becoming willing to certify; the certificate is applied for on the
 * NSW Planning Portal, and between those two points sit three things the tab had
 * nowhere to show:
 *
 *  1. **The lodgement.** A CDC application on the complying development path, a
 *     construction certificate application on the consent path. Never both — see
 *     `certificateKindFor` — so this block renders one, named for the path the
 *     file is actually on.
 *  2. **The principal certifier appointment.** A separate form on the portal
 *     naming whoever will inspect the build. A CDC cannot be determined without
 *     it, which makes it a gate rather than a note, and nothing on the file
 *     recorded it at all.
 *  3. **The determination, which arrives carrying nothing.** The portal emails to
 *     say the application is approved and tells the applicant to log in and
 *     download the certificate. So the honest state after a determination is
 *     "approved, and we hold nothing", and this block is where that is both shown
 *     and resolved.
 *
 * The lodgement itself is `ExternalApplicationBlock`, unchanged, because a
 * certificate application is a portal, a date, a reference and a wait exactly as a
 * road opening permit is. What this component adds around it is the appointment
 * above and the determination below — the two halves the generic block has no
 * concept of.
 */

type PlanningPortalSectionProps = {
  projectId: string;
  /** Which certificate this file will close on, decided by the route it took. */
  kind: CertificateApplicationKind;
  application: ComplianceExternalApplicationRecord | null;
  /** The certificate's own row, so the download has somewhere to land. */
  certificate: ComplianceDocumentWithFiles | undefined;
  /** When the certifier was appointed principal certifier, or null. */
  principalCertifierAppointedAt: Date | null;
  principalCertifierAppointmentRef: string | null;
  /** The certifier's name, for the sentence on the appointment form. */
  certifierName: string | null;
  /**
   * Why nothing here can be lodged yet, or null.
   *
   * Resolved by the caller from `certificateLodgementBlockedReason`, so the
   * sentence on this block and the refusal the server would give are the same
   * words. Null once every gate is clear — the certifier has passed the checklist,
   * the consent is on the file where one is needed, the appointment is recorded
   * where it is needed, and the developer has signed off the plans.
   */
  blockedReason: string | null;
  /**
   * Why the block cannot be opened at all, or null. From
   * `certificateBlockLockedReason`: every lodgement gate except the principal
   * certifier appointment, which is recorded inside this block and so cannot be
   * a reason to hide it.
   */
  lockedReason: string | null;
  rowMode: (
    document?: ComplianceDocumentWithFiles,
  ) => "upload" | "resolve" | "frozen";
  isRowBusy: (
    document: ComplianceDocumentWithFiles | undefined,
    documentType: ComplianceDocumentType,
  ) => boolean;
  onUpload: (
    file: File,
    target: { documentId?: string; documentType: ComplianceDocumentType },
  ) => void;
  onPreviewFile: (fileId: string) => void;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
};

export function PlanningPortalSection({
  projectId,
  kind,
  application,
  certificate,
  principalCertifierAppointedAt,
  principalCertifierAppointmentRef,
  certifierName,
  blockedReason,
  lockedReason,
  rowMode,
  isRowBusy,
  onUpload,
  onPreviewFile,
  isActive,
  open,
  onOpenChange,
  className,
}: PlanningPortalSectionProps) {
  const copy = EXTERNAL_APPLICATION_COPY[kind];
  const documentType = CERTIFICATE_DOCUMENT_TYPE[kind];
  const isCdc =
    kind
    === ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE;

  const hasCertificate = Boolean(certificate?.files.length);
  const isLodged = Boolean(application?.appliedAt);
  /**
   * Determined, whether the portal said so or somebody ticked it through.
   *
   * Both marks read rather than only the first, because an admin who sees the
   * determination on the portal before the email lands is the ordinary case and
   * the block must not keep claiming the application is under assessment.
   */
  const determinedAt =
    application?.approvalNotifiedAt ?? application?.receivedAt ?? null;

  /**
   * Approved, and holding nothing. The state the whole block exists for.
   *
   * Only while there is no certificate on the file: the moment one is uploaded
   * this goes false and the card stops asking for a download it has been given.
   */
  const awaitingDownload = Boolean(determinedAt) && !hasCertificate;

  /**
   * The three things this block tracks, for the header count.
   *
   * Appointment, lodgement, certificate — and the appointment is dropped on the
   * construction certificate path rather than counted and never satisfied. A CC
   * follows a consent the council has already granted and the principal certifier
   * is appointed at the notice of commencement, after this block is finished
   * with, so a permanent "2/3" there would be a card that can never complete.
   */
  const steps = isCdc
    ? [Boolean(principalCertifierAppointedAt), isLodged, hasCertificate]
    : [isLodged, hasCertificate];

  return (
    <ComplianceSectionCard
      title={copy.label}
      description={
        isCdc
          ? "Lodged on the NSW Planning Portal with the certifier appointed as principal certifier."
          : "Lodged on the NSW Planning Portal once consent is granted and the checklist has passed."
      }
      icon={Globe}
      progress={{ done: steps.filter(Boolean).length, total: steps.length }}
      open={open}
      onOpenChange={onOpenChange}
      isActive={isActive}
      ready={awaitingDownload}
      // Locked until the certifier has finished, and shown rather than hidden so
      // a reader working the checklist can see what the checklist is *for*. Not
      // locked on the appointment: its form is in here, and a padlock over it
      // was a dead end. The lodgement below waits for it instead.
      locked={Boolean(lockedReason) && !isLodged}
      lockMessage={lockedReason ?? undefined}
      className={className}
    >
      {/* -------------------------------------------------------------
          The appointment.

          Above the lodgement because it is a condition on it, and on the CDC
          path only — see `steps`. It is its own panel rather than a row on the
          lodgement form because it is not part of the application: two separate
          submissions on the portal, in one sitting, and conflating them would
          mean an admin who did the first and not the second recording both.
      ------------------------------------------------------------- */}
      {isCdc ? (
        <PrincipalCertifierPanel
          projectId={projectId}
          certifierName={certifierName}
          appointedAt={principalCertifierAppointedAt}
          appointmentRef={principalCertifierAppointmentRef}
        />
      ) : null}

      {/* -------------------------------------------------------------
          The lodgement, the wait, and the determination.

          `ExternalApplicationBlock` unchanged, which is the point of having put
          the five permits through it: a certificate application is the same five
          steps, so it gets the same form, the same clock and the same chase copy
          rather than a second implementation that drifts from the first.

          The certificate's row is passed as its `documentRows`, the way the
          development consent is passed to the DA block, and for the same reason:
          the certificate is not a requirement of the application, it is the
          answer to it, so it belongs beside the lodgement that produced it.
      ------------------------------------------------------------- */}
      {/* Open but not yet lodgeable — on a CDC, the appointment above is still
          to be recorded. The same sentence the server refuses the lodgement
          with, where the form would be, so nobody fills in a lodgement only to
          be told no. */}
      {blockedReason && !isLodged && !hasCertificate ? (
        <p
          className={cn(
            "rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground",
            isCdc && "mt-4",
          )}
        >
          {blockedReason}
        </p>
      ) : (
        <div className={isCdc ? "mt-4" : undefined}>
          <ExternalApplicationBlock
            projectId={projectId}
            kind={kind}
            application={application}
            documentRows={
              <ul>
                <ComplianceDocumentRow
                  label={complianceDocumentLabel(documentType)}
                  document={certificate}
                  helperText={
                    hasCertificate
                      ? undefined
                      : "Download it from the NSW Planning Portal and upload it here."
                  }
                  mode={rowMode(certificate)}
                  isBusy={isRowBusy(certificate, documentType)}
                  onUpload={(file) =>
                    onUpload(file, {
                      documentId: certificate?.id,
                      documentType,
                    })
                  }
                  onPreviewFile={onPreviewFile}
                />
              </ul>
            }
          />
        </div>
      )}

      {/* -------------------------------------------------------------
          Approved, and the file holds nothing.

          The banner the whole change is for. It sits below the lodgement rather
          than above it because it is the *last* step on this block, and it is
          green rather than amber because nobody is late: the certifier determined
          the application inside their time and the remaining work is a login.

          Rendered only in that exact state. A determination with the certificate
          already on the file needs no banner, and the row above says so.
      ------------------------------------------------------------- */}
      {awaitingDownload ? (
        <div className="mt-4 rounded-lg border border-success/40 bg-success-light px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2
              className="size-4 shrink-0 text-success-ink"
              aria-hidden="true"
            />
            <p className="font-medium text-foreground">{copy.label} approved</p>
            <StatusPill tone="success">Ready to download</StatusPill>
          </div>

          <p className="mt-1.5 text-sm text-muted-foreground">
            Determined
            {determinedAt
              ? ` on ${dateFormat.format(new Date(determinedAt))}`
              : ""}
            {application?.applicationRef
              ? ` under ${application.applicationRef}`
              : ""}
            . The portal&apos;s email is a notification and does not carry the
            certificate — log in, download it, and upload it to the row above.
          </p>

          <Button asChild type="button" size="sm" className="mt-3">
            <a
              href={PLANNING_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the NSW Planning Portal
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </Button>
        </div>
      ) : null}
    </ComplianceSectionCard>
  );
}

/**
 * The principal certifier appointment, recorded off the portal.
 *
 * Two states and nothing in between: either it has been recorded, in which case
 * the panel states the date and offers to correct it, or it has not, in which case
 * it asks. There is no "in progress" — the appointment happens entirely on the
 * portal and what is tracked here is that it happened.
 *
 * The form is its own disclosure rather than always open, because on a job where
 * the appointment is already in, the thing a reader wants from this panel is one
 * line confirming so.
 */
function PrincipalCertifierPanel({
  projectId,
  certifierName,
  appointedAt,
  appointmentRef,
}: {
  projectId: string;
  certifierName: string | null;
  appointedAt: Date | null;
  appointmentRef: string | null;
}) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.principalCertifier),
  );
  const isSaving = mutation.status === "pending";

  const [isOpen, setIsOpen] = useState(false);

  /** Today in the browser's own calendar, which is the one the picker shows. */
  const today = new Date();
  const asInputDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate(),
    ).padStart(2, "0")}`;

  const [date, setDate] = useState(
    appointedAt ? asInputDate(new Date(appointedAt)) : asInputDate(today),
  );
  const [reference, setReference] = useState(appointmentRef ?? "");

  const submit = async () => {
    if (!date) return;
    try {
      await dispatch(
        recordPrincipalCertifier({
          projectId,
          // Midday rather than midnight, as every date on this tab is: the value
          // is a calendar date with no time on it, and midnight is the one
          // instant a timezone shift moves onto the day before.
          appointedAt: new Date(`${date}T12:00:00`).toISOString(),
          appointmentRef: reference.trim() || undefined,
        }),
      ).unwrap();
      toast.success("Principal certifier appointment recorded.");
      setIsOpen(false);
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not record the appointment.",
      );
    }
  };

  return (
    <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">Principal certifier</p>
        {appointedAt ? (
          <StatusPill tone="success">Appointed</StatusPill>
        ) : (
          <StatusPill tone="warning">Not recorded</StatusPill>
        )}
      </div>

      {appointedAt ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {certifierName ?? "The certifier"} was appointed on{" "}
          <span className="font-medium text-foreground">
            {dateFormat.format(new Date(appointedAt))}
          </span>
          {appointmentRef ? ` under ${appointmentRef}` : ""}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Appoint {certifierName ?? "the certifier"} as principal certifier on
          the NSW Planning Portal, then record it here. A CDC cannot be
          determined without the appointment, so this has to go in with the
          application.{" "}
          <a
            href={PLANNING_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            NSW Planning Portal
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
      )}

      {isOpen ? (
        <form
          className="mt-3 space-y-3 rounded-lg border border-border/70 bg-background p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pc-appointed-at">Date appointed</Label>
            <Input
              id="pc-appointed-at"
              type="date"
              value={date}
              max={asInputDate(today)}
              onChange={(event) => setDate(event.target.value)}
              disabled={isSaving}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pc-appointment-ref">
              Appointment reference{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="pc-appointment-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="From the portal receipt"
              disabled={isSaving}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isSaving || !date}>
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save appointment
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={appointedAt ? "ghost" : "outline"}
          className="mt-3"
          disabled={isSaving}
          onClick={() => setIsOpen(true)}
        >
          {appointedAt ? "Correct the appointment" : "Record the appointment"}
        </Button>
      )}
    </div>
  );
}
