"use client";

// The always-visible money line.
//
// It replaces a 360px sticky rail whose seven price rows were the same seven
// rows already printed inside the Price build-up card on step 3 — 534px of
// content holding a fifth of the width open across a 13,867px page, duplicating
// something on screen at the same time. Its only unique content was the margin
// badge, which is why that badge is kept here.
//
// The hero figure is the SELECTED contract value, the number the customer's
// document actually carries. The old rail showed the computed build-up total, so
// the moment an estimator used the price override the largest, most persistent
// number on screen stopped being the number on the offer. The cells beside it
// are on that same price; see buildOfferSummaryFigures.

import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatMoneyDelta,
  formatPercent,
  getMarginStatusLabel,
  moneyDeltaFractionDigits,
} from "@/components/offers/new-workflow/offer-workspace-format";
import { buildOfferSummaryFigures } from "@/lib/offer/summary-strip";
import { formatArea } from "@/lib/offer/workspace-print-template";
import type {
  EffectiveMargin,
  MarginStatus,
  OfferCustomerPrice,
  OfferWorkspacePricing,
} from "@/lib/offer/workspace-pricing";

function marginToneClass(status: MarginStatus): string {
  switch (status) {
    case "at_target":
      return "bg-success-light text-success-ink";
    case "acceptable_below_target":
      return "bg-warning-light text-warning-ink";
    case "below_minimum":
      return "bg-destructive-light text-destructive-ink";
    case "not_priced":
      return "bg-muted text-muted-foreground";
  }
}

type OfferSummaryStripProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly effectiveMargin: EffectiveMargin;
  readonly pricing: OfferWorkspacePricing;
  readonly totalAreaSqm: number;
  // Until the offer loads every figure here is a seeded default, and a price
  // stated with confidence beside a "Loading this offer…" pane is worse than no
  // price: it reads as this offer's money. The whole strip goes neutral.
  readonly awaitingOffer: boolean;
};

export function OfferSummaryStrip({
  customerPrice,
  effectiveMargin,
  pricing,
  totalAreaSqm,
  awaitingOffer,
}: OfferSummaryStripProps) {
  const selected = customerPrice.selectedContractValueIncGst;
  const figures = buildOfferSummaryFigures({
    customerPrice,
    pricing,
    totalAreaSqm,
  });
  const priced = effectiveMargin.marginStatus !== "not_priced";

  // Blank while the offer is still loading: every figure below is a seeded
  // default until then, and a price stated with confidence beside a loading
  // pane reads as this offer's money.
  const cells: readonly (readonly [string, string])[] = awaitingOffer
    ? [
        ["Building area", "—"],
        ["Direct total", "—"],
        ["Cost before fee", "—"],
        ["GST", "—"],
        ["Per m² (offer price)", "—"],
      ]
    : [
        ["Building area", totalAreaSqm > 0 ? formatArea(totalAreaSqm) : "—"],
        ["Direct total", formatCurrency(pricing.directTotal)],
        ["Cost before fee", formatCurrency(pricing.costBeforeFee)],
        ["GST", formatCurrency(figures.gstOnOffer)],
        [
          "Per m² (offer price)",
          figures.perSqm === null ? "—" : formatCurrency(figures.perSqm),
        ],
      ];

  return (
    // The old right rail was an <aside>; this is its replacement and keeps the
    // landmark so the totals are reachable by region navigation.
    <aside
      aria-label="Offer totals"
      className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/70 bg-white px-5 py-2.5"
    >
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {cells.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-sm font-medium tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="ml-auto flex items-center gap-3">
        {awaitingOffer ? (
          // Every figure in this group comes from the same seeded state as the
          // cells above: the override badge compares two placeholder numbers,
          // the margin badge grades a placeholder markup, and the contract
          // value is the largest number on the screen. None of it is this
          // offer's until it has loaded.
          <p className="font-heading text-lg font-semibold tabular-nums text-muted-foreground">
            <span className="sr-only">Contract value including GST: </span>—
          </p>
        ) : (
          <>
            {/* An override means the build-up and the offer disagree. Say so, rather
            than showing two large numbers in different places and letting the
            operator discover the gap on the document. */}
            {figures.overridden ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-medium tabular-nums text-warning-ink">
                <TriangleAlert className="size-3" aria-hidden="true" />
                {formatMoneyDelta(figures.overrideDeltaIncGst)} vs{" "}
                {formatCurrency(customerPrice.computedContractValueIncGst, {
                  // A cents override would otherwise read "+$0.37 vs $950,000"
                  // beside a $950,000 hero, with nothing visibly different.
                  maximumFractionDigits: moneyDeltaFractionDigits(
                    figures.overrideDeltaIncGst,
                  ),
                })}{" "}
                build-up
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                marginToneClass(effectiveMargin.marginStatus),
              )}
            >
              {/* Unpriced has no margin, so no verdict icon and no 0% beside it. */}
              {!priced ? null : effectiveMargin.marginStatus === "at_target" ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-3" aria-hidden="true" />
              )}
              {getMarginStatusLabel(effectiveMargin.marginStatus)}
              {priced
                ? ` · ${formatPercent(effectiveMargin.effectiveMarkupPct)}`
                : null}
            </span>
            <p className="font-heading text-lg font-semibold tabular-nums">
              <span className="sr-only">Contract value including GST: </span>
              {formatCurrency(selected)}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
