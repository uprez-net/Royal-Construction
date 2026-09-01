"use client";

import { ComplianceDocumentStatus } from "@prisma/client";
import {
  Check,
  ChevronDown,
  FileText,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ChecklistItemDetail,
  ComplianceDocumentWithFiles,
} from "@/types/compliance";
import { dataTimeFormat } from "@/utils/formatters";

const STATUS_TONE = {
  [ComplianceDocumentStatus.PENDING]: "neutral",
  [ComplianceDocumentStatus.UPLOADED]: "primary",
  [ComplianceDocumentStatus.RECEIVED]: "primary",
  [ComplianceDocumentStatus.APPROVED]: "success",
  [ComplianceDocumentStatus.REJECTED]: "danger",
  [ComplianceDocumentStatus.NOT_REQUIRED]: "neutral",
} as const;

const STATUS_LABEL = {
  [ComplianceDocumentStatus.PENDING]: "Outstanding",
  [ComplianceDocumentStatus.UPLOADED]: "Uploaded",
  [ComplianceDocumentStatus.RECEIVED]: "Received",
  [ComplianceDocumentStatus.APPROVED]: "Approved",
  [ComplianceDocumentStatus.REJECTED]: "Rejected",
  [ComplianceDocumentStatus.NOT_REQUIRED]: "Not required",
} as const;

type ComplianceDocumentRowProps = {
  label: string;
  document?: ComplianceDocumentWithFiles;
  /** Shown under the label when the document has not been supplied yet. */
  helperText?: string;
  /**
   * What the certifier said about this line beyond its name. Optional
   * everywhere: only checklist items ever carry it, and only once a checklist
   * has been read by the enriched extraction.
   */
  detail?: ChecklistItemDetail | null;
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
   * Marks the line as not applying to this job, or puts it back.
   *
   * Only passed for checklist items, and only for an admin — it is the one
   * judgement on this row that nothing infers. Absent means the control is not
   * offered, which is every other kind of document.
   */
  onSetNotRequired?: (notRequired: boolean) => void;
  /**
   * Opens a stored file in the in-app viewer. The row does not decide which
   * viewer, or what a picture's gallery contains — the tab owns the pool of
   * sibling images, which spans every document on the engagement rather than
   * just the one or two attached to this row.
   */
  onPreviewFile?: (fileId: string) => void;
};

/**
 * The certifier's own conditions on one item, behind a disclosure.
 *
 * A disclosure rather than the tooltip the rest of this row uses, because of
 * what actually turns up in here: a single checklist line can carry nine
 * numbered amendments — "Staircase area cannot be deducted on ground floor. GFA
 * calculation sheet A17 need to be corrected" — plus the standards it has to
 * meet. That is not hover content. It does not open on touch, it cannot be
 * selected or copied into a message to the draftsman, and it would need its own
 * scrollbar inside a tooltip sized for a filename.
 *
 * Collapsed by default so a twenty-row checklist still reads as a list, and the
 * one row somebody came to work on is one click from everything it needs.
 */
function RequirementDisclosure({
  requirements,
  references,
}: {
  requirements: string[];
  references: string[];
}) {
  const [open, setOpen] = useState(false);

  const parts = [
    requirements.length
      ? `${requirements.length} requirement${requirements.length === 1 ? "" : "s"}`
      : null,
    references.length
      ? `${references.length} reference${references.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1.5">
      <CollapsibleTrigger
        className={cn(
          "flex items-center gap-1 rounded text-sm text-primary",
          "underline-offset-4 hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
        {parts.join(" · ")}
      </CollapsibleTrigger>

      {/* Indented rather than boxed. The row is deliberately flat (see the
          component note below) and a bordered panel here would reintroduce
          exactly the nesting this layout rejected. */}
      <CollapsibleContent className="overflow-hidden data-open:animate-collapsible-down data-closed:animate-collapsible-up">
        <div className="mt-2 space-y-3 border-l-2 border-border pl-3">
          {requirements.length > 0 ? (
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground marker:text-muted-foreground/70">
              {requirements.map((requirement, index) => (
                <li key={index}>{requirement}</li>
              ))}
            </ol>
          ) : null}

          {references.length > 0 ? (
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                References
              </p>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {references.map((reference, index) => (
                  <li key={index}>{reference}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

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
  detail,
  mode,
  isBusy = false,
  onUpload,
  onApprove,
  onReject,
  onSetNotRequired,
  onPreviewFile,
}: ComplianceDocumentRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const status = document?.status ?? ComplianceDocumentStatus.PENDING;
  const files = document?.files ?? [];

  /**
   * The admin has said this line does not apply to this job.
   *
   * The row goes quiet rather than disappearing: the certifier listed it, and
   * someone auditing the file later needs to see that it was considered and
   * set aside, not that it was never there.
   */
  const notRequired = status === ComplianceDocumentStatus.NOT_REQUIRED;

  /**
   * Whether what is currently attached is what the certifier sent back.
   *
   * There is no per-file verdict to read — a rejection lands on the document,
   * and what hangs off it is whatever the last upload left there — so the
   * reason being set is exactly "everything on this row is the attempt they
   * refused". It clears the moment a replacement is uploaded, which is also
   * when the replacement supersedes those files, so the two move together
   * without a marker of their own.
   */
  const sentBack = Boolean(document?.rejectionReason);

  const requirements = detail?.requirements ?? [];
  const references = detail?.references ?? [];
  const hasDisclosure =
    !notRequired && (requirements.length > 0 || references.length > 0);

  // The certifier's own explanation of the item, which says more than "Not
  // supplied yet" ever could, so it takes that slot when there is one.
  const supportingText = detail?.description ?? helperText;

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-border/70 py-3 last:border-b-0">
      <FileText
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "font-medium text-foreground",
              // Struck, not hidden — the same treatment a superseded file gets
              // below, and for the same reason: it is still part of the record.
              notRequired && "text-muted-foreground line-through",
            )}
          >
            {label}
          </p>
          <StatusPill tone={STATUS_TONE[status]}>
            {STATUS_LABEL[status]}
          </StatusPill>
        </div>

        {files.length > 0 ? (
          // Site photographs and scans arrive named things like
          // "WhatsApp Image 2025-08-14 at 09.41.22 (3).jpeg". Twenty of those
          // set the width of a card that is meant to sit three to a row, so the
          // name is clipped and the full one moves into the tooltip — which is
          // where the rejection note goes too, because the file it belongs to
          // is the thing the reader is already pointing at.
          <TooltipProvider>
            <ul className="mt-1 space-y-0.5">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex min-w-0 items-baseline gap-2 text-sm"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* A button, not a link: this opens a viewer in place
                          rather than navigating, and handing the tab to a blob
                          URL is what this replaced. */}
                      <button
                        type="button"
                        onClick={() => onPreviewFile?.(file.id)}
                        className={cn(
                          "min-w-0 truncate text-left underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          sentBack
                            ? // Struck rather than hidden: it is still the only
                              // evidence of what was tried, and it still opens.
                              "text-muted-foreground line-through decoration-destructive-ink/70"
                            : "text-primary hover:underline",
                        )}
                      >
                        {file.filename}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={6}
                      className="max-w-xs flex-col items-stretch gap-1 py-2 text-left"
                    >
                      <p className="break-all">{file.filename}</p>
                      {sentBack ? (
                        <p className="border-t border-background/25 pt-1 text-background/80">
                          Sent back: {document?.rejectionReason}
                        </p>
                      ) : null}
                    </TooltipContent>
                  </Tooltip>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dataTimeFormat.format(new Date(file.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        ) : supportingText ? (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {supportingText}
          </p>
        ) : null}

        {hasDisclosure ? (
          <RequirementDisclosure
            requirements={requirements}
            references={references}
          />
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
        {/* Offered before the upload control and kept beside it, because the
            two are the same decision from opposite ends: supply this, or say it
            is not needed. A row already set aside offers only the way back. */}
        {onSetNotRequired ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => onSetNotRequired(!notRequired)}
            className="text-muted-foreground"
          >
            {notRequired ? (
              <>
                <RotateCcw className="size-4" aria-hidden="true" />
                Required after all
              </>
            ) : (
              <>
                <X className="size-4" aria-hidden="true" />
                Not required
              </>
            )}
            <span className="sr-only"> — {label}</span>
          </Button>
        ) : null}

        {mode === "upload" && !notRequired ? (
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
