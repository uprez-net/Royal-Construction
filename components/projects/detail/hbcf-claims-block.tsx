"use client";

import { HBCF_FILE_TAG } from "@/lib/domain/insurance/hbcf-claims";
import { useId } from "react";
import { format, isValid, parse } from "date-fns";
import type { File as DBFile } from "@prisma/client";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { UploadButton } from "@/components/common/upload-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hbcfClaimDateConflicts,
  hbcfClaimTotal,
  normalizeClaimAmount,
  type HbcfClaimExclusionReason,
} from "@/lib/domain/insurance/hbcf-claims";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import type { HbcfClaimDocument } from "@/types/project-flow";
import { fileHref } from "@/lib/files/file-href";

/** How many HBCF PDFs one upload may carry. */
const MAX_HBCF_UPLOAD = 10;

const amountFormat = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

/** "3 Mar 2026", or the stored text as-is when it is not a `yyyy-MM-dd` day. */
function displayDate(isoDate: string) {
  const parsed = parse(isoDate, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? format(parsed, "d MMM yyyy") : isoDate;
}

const EXCLUSION_COPY: Record<HbcfClaimExclusionReason, string> = {
  "duplicate-certificate":
    "Same certificate no. as an earlier document, so not counted again",
  "duplicate-file": "This file is already listed",
  missing: "No claim amount yet, so not counted",
  unconfirmed: "Read from the PDF. Confirm it to count it",
};

/**
 * The HBCF certificate number, every HBCF claim document on the project and
 * the Total HBCF Claim Amount (issue #423).
 *
 * The number stays editable by hand: OCR on a photographed certificate is not
 * reliable enough to be the only way in, and the red alert is driven by the
 * number rather than by the presence of a document, so an unreadable upload
 * leaves the prompt up instead of quietly marking the job insured.
 *
 * Amounts read off a PDF arrive unconfirmed and are left out of the total
 * until somebody confirms or corrects them; the total is computed by the same
 * `hbcfClaimTotal` the HBCF capacity pool uses.
 */
export function HbcfClaimsBlock({
  projectId,
  insuranceNumber,
  documents,
  claimDate,
  extracting,
  canRemove,
  onNumberChange,
  onDocumentsChange,
  onUpload,
}: {
  projectId: string;
  insuranceNumber: string | null;
  documents: readonly HbcfClaimDocument[];
  /** The project's claim date (`insuranceClaimStartDate`), `yyyy-MM-dd`. */
  claimDate: string | null;
  extracting: boolean;
  canRemove: boolean;
  onNumberChange: (value: string | null) => void;
  onDocumentsChange: (documents: HbcfClaimDocument[]) => void;
  onUpload: (files: DBFile[]) => void;
}) {
  const id = useId();
  const dispatch = useAppDispatch();
  const hasNumber = (insuranceNumber ?? "").trim().length > 0;
  const { counted, excluded, total } = hbcfClaimTotal(documents);
  const { conflicting, documentDates } = hbcfClaimDateConflicts(
    documents,
    claimDate,
  );
  const conflictingIds = new Set(conflicting.map((doc) => doc.fileId));

  const patchDocument = (fileId: string, patch: Partial<HbcfClaimDocument>) =>
    onDocumentsChange(
      documents.map((doc) =>
        doc.fileId === fileId ? { ...doc, ...patch } : doc,
      ),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-sm font-semibold text-foreground">HBCF claim</h4>
        <p className="text-xs text-muted-foreground">
          Upload one or more HBCF PDFs. The number, date and amount are read
          automatically; check each amount before it counts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor={id}
            className="text-xs font-medium text-muted-foreground"
          >
            HBCF insurance no.
          </Label>
          <Input
            id={id}
            value={insuranceNumber ?? ""}
            onChange={(e) =>
              onNumberChange(e.target.value.trim() ? e.target.value : null)
            }
            placeholder="Not recorded yet"
            disabled={extracting}
            className="h-9"
          />
        </div>

        <div className="flex flex-col justify-end gap-1.5">
          <UploadButton
            projectId={projectId}
            maxFiles={MAX_HBCF_UPLOAD}
            accept="application/pdf,.pdf"
            hints={{
              trail: ["HBCF insurance"],
              tags: [HBCF_FILE_TAG, "Insurance certificate"],
            }}
            onUpload={onUpload}
          />
          <p className="text-[11px] text-muted-foreground">
            {documents.length > 0
              ? "Adds to the documents below. Nothing already here is replaced."
              : `PDF, up to ${MAX_HBCF_UPLOAD} at a time.`}
          </p>
          {extracting ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2
                aria-hidden="true"
                className="h-3 w-3 animate-spin motion-reduce:animate-none"
              />
              Reading the documents&hellip;
            </p>
          ) : null}
        </div>
      </div>

      {hasNumber ? null : (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive-light px-3 py-2 text-sm text-destructive-ink"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <p>Upload the insurance document to update the no.</p>
        </div>
      )}

      {documents.length > 0 ? (
        <ul className="divide-y divide-border/70 rounded-lg border border-border bg-card">
          {documents.map((doc) => {
            const reason = excluded.get(doc.fileId);
            const amountId = `${id}-amount-${doc.fileId}`;
            const dateConflict = conflictingIds.has(doc.fileId);
            return (
              <li
                key={doc.fileId}
                className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <FileText
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="wrap-break-word">
                      {doc.fileName || "HBCF document"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doc.certificateNumber
                      ? `Certificate ${doc.certificateNumber}`
                      : "No certificate no. read"}
                    {doc.coverStartDate
                      ? ` · cover from ${displayDate(doc.coverStartDate)}`
                      : null}
                  </p>
                  {dateConflict ? (
                    <p className="flex items-start gap-1.5 text-xs text-warning-ink">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-3 w-3 shrink-0"
                      />
                      {claimDate
                        ? `This document's date differs from the project's claim date (${displayDate(claimDate)}). Check which is right; the start date follows the claim date.`
                        : "The documents disagree about the cover start date. Set the Insurance Claim Start Date above."}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-primary"
                      onClick={() =>
                        dispatch(
                          openModal({
                            type: "previewFile",
                            payload: { fileUrl: doc.url },
                          }),
                        )
                      }
                      aria-label={`View ${doc.fileName || "HBCF document"}`}
                    >
                      <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                      View
                    </Button>
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-primary"
                    >
                      <a
                        href={fileHref(doc.url)}
                        download={doc.fileName || true}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Download ${doc.fileName || "HBCF document"}`}
                      >
                        <Download aria-hidden="true" className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </Button>
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive-ink"
                        onClick={() =>
                          onDocumentsChange(
                            documents.filter(
                              (other) => other.fileId !== doc.fileId,
                            ),
                          )
                        }
                        aria-label={`Remove ${doc.fileName || "HBCF document"} from the HBCF claim`}
                        title="Removes it from the claim. The file stays in Documents."
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1.5 sm:w-52">
                  <Label
                    htmlFor={amountId}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Claim amount (AUD)
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={amountId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={doc.claimAmount ?? ""}
                      placeholder="0.00"
                      disabled={extracting}
                      // Typing an amount is a person stating it, so it counts.
                      onChange={(e) =>
                        patchDocument(doc.fileId, {
                          amountConfirmed: true,
                          claimAmount: normalizeClaimAmount(e.target.value),
                        })
                      }
                      className="h-9 font-mono tabular-nums"
                      aria-describedby={reason ? `${amountId}-note` : undefined}
                    />
                    {reason === "unconfirmed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 shrink-0"
                        onClick={() =>
                          patchDocument(doc.fileId, { amountConfirmed: true })
                        }
                      >
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        Confirm
                      </Button>
                    ) : null}
                  </div>
                  {reason ? (
                    <p
                      id={`${amountId}-note`}
                      className="text-[11px] leading-snug text-warning-ink"
                    >
                      {EXCLUSION_COPY[reason]}
                    </p>
                  ) : (
                    <StatusPill tone="success">Counted</StatusPill>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!claimDate && documentDates.length > 1 ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-sm text-warning-ink"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <p>
            The documents show different cover start dates (
            {documentDates.map(displayDate).join(", ")}). Set the Insurance
            Claim Start Date above; the project start date follows it.
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border px-4 py-3",
          "border-primary/30 bg-primary/5",
        )}
        aria-live="polite"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">
            Total HBCF claim amount
          </p>
          <p className="text-xs text-muted-foreground">
            {documents.length === 0
              ? "No HBCF documents yet."
              : `${counted.length} of ${documents.length} document${documents.length === 1 ? "" : "s"} counted.`}
          </p>
        </div>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {amountFormat.format(total)}
        </p>
      </div>
    </div>
  );
}
