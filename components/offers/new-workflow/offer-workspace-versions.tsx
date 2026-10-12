"use client";

import { useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listOfferRevisions,
  type OfferRevisionSummary,
} from "@/lib/data/offer-workspace";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import { FileText, History, Loader2, ScrollText } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";
import { OfferRevisionViewerDialog } from "./offer-revision-viewer-dialog";

// Revision timeline for the lead's offer family. Fetches on open (so it always
// reflects a just-created revision) and lists each version's reference, status,
// date, price, plus download links for any executed Tender/Contract PDF.
export function OfferVersionsMenu({
  leadId,
  activeRevisionNumber,
}: {
  readonly leadId: number;
  readonly activeRevisionNumber: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<
    readonly OfferRevisionSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  // Held here rather than inside VersionRow so the dialog outlives the popover
  // that launched it — the popover closes on select so the two don't fight over
  // focus, which would unmount a dialog rendered inside its subtree.
  const [viewingOfferId, setViewingOfferId] = useState<string | null>(null);
  // The row that opened the dialog is inside the popover, which unmounts on
  // select — so Radix has nothing to restore focus to on close. Hand it the
  // Versions button instead, or focus falls to <body> and a keyboard user
  // restarts from the top of the page.
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        setVersions(await listOfferRevisions(leadId));
      } catch {
        setError("Couldn't load version history.");
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleSelect(offerId: string) {
    setOpen(false);
    setViewingOfferId(offerId);
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange} modal>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            aria-label="Versions"
            size="sm"
            type="button"
            variant="outline"
          >
            <History className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Versions</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 max-w-[calc(100vw-1rem)] p-0"
        >
          <div className="border-b border-border/70 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Version history
            </p>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground">
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Loading…
            </div>
          ) : error ? (
            <p className="px-3 py-5 text-sm text-destructive">{error}</p>
          ) : versions && versions.length > 0 ? (
            <ul className="max-h-80 divide-y divide-border/70 overflow-y-auto">
              {versions.map((version) => (
                <VersionRow
                  key={version.offerId}
                  version={version}
                  isActive={version.revisionNumber === activeRevisionNumber}
                  onSelect={() => handleSelect(version.offerId)}
                />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-5 text-sm text-muted-foreground">
              No versions yet.
            </p>
          )}
        </PopoverContent>
      </Popover>
      <OfferRevisionViewerDialog
        offerId={viewingOfferId}
        onClose={() => setViewingOfferId(null)}
        restoreFocusRef={triggerRef}
      />
    </>
  );
}

function VersionRow({
  version,
  isActive,
  onSelect,
}: {
  readonly version: OfferRevisionSummary;
  readonly isActive: boolean;
  readonly onSelect: () => void;
}) {
  const statusLabel =
    OFFER_STATUS_LABEL[version.status.toLowerCase() as OfferWorkspaceStatus]
    ?? version.status;
  const date = new Date(version.createdAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <li className="grid gap-1 px-3 py-2.5">
      {/* Only the summary is the button. The PDF links stay outside it —
          nesting an anchor inside a button is invalid and leaves the link
          unreachable by keyboard. */}
      <button
        type="button"
        className="grid w-full gap-1 rounded-sm text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={onSelect}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-xs font-medium text-foreground">
              {version.reference}
            </span>
            {isActive ? (
              <Badge className="shrink-0 bg-royal-gold-ink text-white">
                Current
              </Badge>
            ) : null}
          </span>
          <Badge className="shrink-0" variant="secondary">
            {statusLabel}
          </Badge>
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{date}</span>
          <span className="font-mono">
            {version.contractValueIncGst !== null
              ? formatCurrency(version.contractValueIncGst)
              : "—"}
          </span>
        </span>
      </button>
      {version.tenderPdfUrl || version.contractPdfUrl ? (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {version.tenderPdfUrl ? (
            <PdfLink
              href={version.tenderPdfUrl}
              icon={<FileText className="size-3.5" aria-hidden="true" />}
              label="Tender PDF"
            />
          ) : null}
          {version.contractPdfUrl ? (
            <PdfLink
              href={version.contractPdfUrl}
              icon={<ScrollText className="size-3.5" aria-hidden="true" />}
              label="Contract PDF"
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PdfLink({
  href,
  icon,
  label,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-royal-gold-dark transition-colors hover:bg-royal-gold-light/40"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {icon}
      {label}
    </a>
  );
}
