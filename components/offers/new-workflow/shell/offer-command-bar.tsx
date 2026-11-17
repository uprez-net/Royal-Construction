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
    // On a phone this is two short rows — the address beside the actions, then
    // the badges and save state — instead of three. The contract value is left
    // to the summary strip there, which already shows it at the bottom of the
    // same frame. From md up every item sits on one line via `md:contents`.
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/70 bg-card px-3 py-2 md:flex-nowrap md:gap-x-2.5 md:px-4 md:py-2.5">
      {/* The page's only h1. Screen readers get the offer's identity here;
          sighted users get it from the badge and address. */}
      <h1
        id="new-offer-workspace-title"
        className="min-w-0 flex-1 basis-0 truncate text-sm font-medium md:order-2 md:flex-initial md:basis-auto"
      >
        <span className="sr-only">Offer workspace for </span>
        {awaitingOffer ? "Loading offer…" : job.siteAddress || "New offer"}
      </h1>

      <div className="flex shrink-0 items-center gap-2 md:order-6">
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

      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:contents">
        <Badge className="shrink-0 bg-royal-gold-light font-mono text-royal-gold-ink-text md:order-1">
          {awaitingOffer
            ? "Loading…"
            : formatOfferReference(job.reference, job.revision)}
        </Badge>
        <span className="hidden shrink-0 truncate text-sm text-muted-foreground md:order-3 lg:inline">
          {owners}
        </span>
        <Badge variant="secondary" className="shrink-0 md:order-4">
          {awaitingOffer ? "Loading" : OFFER_STATUS_LABEL[status]}
        </Badge>
        <ExpiryChip
          className="md:order-4"
          expiry={awaitingOffer ? null : offerExpiry}
        />
        {/* A failed save must stay in sight on a phone too; this copy is the
            phone's, the one beside the price below is the desktop's. */}
        <span className="md:hidden">
          <SaveIndicator state={saveState} onRetry={onRetrySave} />
        </span>
      </div>

      <div className="hidden shrink-0 text-right md:order-5 md:ml-auto md:block">
        <p className="font-mono text-sm font-semibold leading-none tabular-nums">
          <span className="sr-only">Contract value including GST: </span>
          {awaitingOffer
            ? "—"
            : formatCurrency(customerPrice.selectedContractValueIncGst)}
        </p>
        <div className="mt-1 flex justify-end">
          <SaveIndicator state={saveState} onRetry={onRetrySave} />
        </div>
      </div>
    </header>
  );
}
