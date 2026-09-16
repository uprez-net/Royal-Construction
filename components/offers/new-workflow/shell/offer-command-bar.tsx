"use client";

// The workspace's top chrome, in one row.
//
// It replaces a 275px block: a bordered header card (reference, status badges,
// an h1 reading "New Offer workspace", client line, price tile, four buttons)
// stacked above a ten-node horizontal stepper. On an 800px laptop that was 34%
// of the viewport spent before any work appeared, and the stepper's six locked
// nodes were unreachable most of the time. The rail carries step state now, so
// this row carries identity, price, save state and the actions.

import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExpiryChip,
  SaveIndicator,
} from "@/components/offers/new-workflow/offer-workspace-header";
import { OfferVersionsMenu } from "@/components/offers/new-workflow/offer-workspace-versions";
import { formatOfferReference } from "@/components/offers/new-workflow/offer-workspace-format";
import { formatCurrency } from "@/components/offers/new-workflow/offer-workspace-format";
import type { OfferSaveState } from "@/components/offers/new-workflow/offer-workspace-screen";
import type { OfferExpiry } from "@/lib/offer/offer-readiness";
import {
  formatOwnerNamesLine,
  OFFER_STATUS_LABEL,
  type OfferWorkspaceJob,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";

type OfferCommandBarProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly job: OfferWorkspaceJob;
  readonly leadId?: number;
  readonly offerExpiry: OfferExpiry | null;
  readonly saveState: OfferSaveState;
  readonly status: OfferWorkspaceStatus;
  readonly onDownloadPreview: () => void;
  readonly onRetrySave: () => void;
  // The print template renders from the workspace state, which is seeded until
  // the offer loads. Downloading before then handed the estimator a document
  // built from placeholder content, looking exactly like the customer's offer.
  readonly awaitingOffer: boolean;
};

export function OfferCommandBar({
  customerPrice,
  job,
  leadId,
  offerExpiry,
  saveState,
  status,
  onDownloadPreview,
  onRetrySave,
  awaitingOffer,
}: OfferCommandBarProps) {
  const activeRevisionNumber =
    Number.parseInt(job.revision.replace(/\D/g, ""), 10) || 1;
  const owners = formatOwnerNamesLine(job.owners ?? []) || job.clientNames;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 bg-white px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Badge className="shrink-0 bg-royal-gold-ink font-mono text-white">
          {formatOfferReference(job.reference, job.revision)}
        </Badge>
        {/* The page's only h1. Screen readers get the offer's identity here;
            sighted users get it from the badge and address. */}
        <h1
          id="new-offer-workspace-title"
          className="min-w-0 truncate text-sm font-medium"
        >
          <span className="sr-only">Offer workspace for </span>
          {job.siteAddress || "New offer"}
        </h1>
        <span className="hidden shrink-0 truncate text-sm text-muted-foreground lg:inline">
          {owners}
        </span>
        <Badge variant="secondary" className="shrink-0">
          {OFFER_STATUS_LABEL[status]}
        </Badge>
        <ExpiryChip expiry={offerExpiry} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="text-right">
          <p className="font-mono text-sm font-semibold leading-none tabular-nums">
            <span className="sr-only">Contract value including GST: </span>
            {formatCurrency(customerPrice.selectedContractValueIncGst)}
          </p>
          <div className="mt-1 flex justify-end">
            <SaveIndicator state={saveState} onRetry={onRetrySave} />
          </div>
        </div>
        <Button
          aria-label="Download offer"
          className="h-8"
          size="sm"
          type="button"
          variant="outline"
          disabled={awaitingOffer}
          title={awaitingOffer ? "Waiting for the offer to load" : undefined}
          onClick={onDownloadPreview}
        >
          <Download className="size-3.5" aria-hidden="true" />
          <span className="hidden lg:inline">Download offer</span>
        </Button>
        {leadId !== undefined ? (
          <OfferVersionsMenu
            leadId={leadId}
            activeRevisionNumber={activeRevisionNumber}
          />
        ) : null}
      </div>
    </header>
  );
}
