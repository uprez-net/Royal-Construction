"use client";

import { ComplianceDocumentStatus } from "@prisma/client";
import { Check, FileText, Loader2, Upload, X } from "lucide-react";
import { useRef } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";
import { dataTimeFormat } from "@/utils/formatters";

const STATUS_TONE = {
  [ComplianceDocumentStatus.PENDING]: "neutral",
  [ComplianceDocumentStatus.UPLOADED]: "primary",
  [ComplianceDocumentStatus.RECEIVED]: "primary",
  [ComplianceDocumentStatus.APPROVED]: "success",
  [ComplianceDocumentStatus.REJECTED]: "danger",
} as const;

const STATUS_LABEL = {
  [ComplianceDocumentStatus.PENDING]: "Outstanding",
  [ComplianceDocumentStatus.UPLOADED]: "Uploaded",
  [ComplianceDocumentStatus.RECEIVED]: "Received",
  [ComplianceDocumentStatus.APPROVED]: "Approved",
  [ComplianceDocumentStatus.REJECTED]: "Rejected",
} as const;

type ComplianceDocumentRowProps = {
  label: string;
  document?: ComplianceDocumentWithFiles;
  /** Shown under the label when the document has not been supplied yet. */
  helperText?: string;
  /**
   * "upload" while the admin is still assembling the file; "resolve" once it is
   * with the certifier for review; "frozen" once approved or while a request is
   * in flight.
   */
  mode: "upload" | "resolve" | "frozen";
  isBusy?: boolean;
  onUpload?: (file: File) => void;
  onApprove?: () => void;
  onReject?: () => void;
  /**
   * Opens a stored file in the in-app viewer. The row does not decide which
   * viewer, or what a picture's gallery contains — the tab owns the pool of
   * sibling images, which spans every document on the engagement rather than
   * just the one or two attached to this row.
   */
  onPreviewFile?: (fileId: string) => void;
};

/**
 * One tracked document.
 *
 * Deliberately a flat row rather than a nested card, matching what
 * milestone-card.tsx settled on: a compliance file is a list of twenty of these
 * and bordered boxes inside bordered boxes make it unreadable.
 */
export function ComplianceDocumentRow({
  label,
  document,
  helperText,
  mode,
  isBusy = false,
  onUpload,
  onApprove,
  onReject,
  onPreviewFile,
}: ComplianceDocumentRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = document?.status ?? ComplianceDocumentStatus.PENDING;
  const files = document?.files ?? [];

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-border/70 py-3 last:border-b-0">
      <FileText
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{label}</p>
          <StatusPill tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}
          </StatusPill>
        </div>

        {files.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {files.map((file) => (
              <li key={file.id} className="text-sm">
                {/* A button, not a link: this opens a viewer in place rather
                    than navigating, and handing the tab to a blob URL is what
                    this replaced. */}
                <button
                  type="button"
                  onClick={() => onPreviewFile?.(file.id)}
                  className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {file.filename}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  {dataTimeFormat.format(new Date(file.createdAt))}
                </span>
              </li>
            ))}
          </ul>
        ) : helperText ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{helperText}</p>
        ) : null}

        {/* The reason survives the status going back to PENDING — it is the
            only thing telling the admin what to change before re-uploading. */}
        {document?.rejectionReason ? (
          <p className="mt-1 text-sm text-destructive-ink">
            Sent back by the certifier: {document.rejectionReason}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {mode === "upload" ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload?.(file);
                // Cleared so re-picking the same file still fires a change.
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              {files.length > 0 ? "Replace" : "Upload"}
              <span className="sr-only"> {label}</span>
            </Button>
          </>
        ) : null}

        {mode === "resolve" ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={onReject}
              className={cn(
                "border-destructive/40 text-destructive-ink",
                "hover:bg-destructive-light",
              )}
            >
              <X className="size-4" aria-hidden="true" />
              Reject
              <span className="sr-only"> {label}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={onApprove}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Approve
              <span className="sr-only"> {label}</span>
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
