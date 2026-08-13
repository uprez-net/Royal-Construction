"use client";

// The at-a-glance pricing panel that sits beside the offer workspace steps.
// Extracted from the old offer-workspace-preview.tsx when the document canvas
// replaced that file's inline offer preview; the pricing panel is still wanted
// on every step, the narrow document preview was not.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  EffectiveMargin,
  MarginStatus,
  OfferWorkspacePricing,
} from "@/lib/offer/workspace-pricing";
import { ReceiptText } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  formatCurrency,
  formatPercent,
  getMarginStatusLabel,
} from "./offer-workspace-format";

type PricingSummaryProps = {
  readonly pricing: OfferWorkspacePricing;
  // Margin at the actual (possibly overridden) selling price — drives the badge.
  readonly effectiveMargin: EffectiveMargin;
};

function getMarginBadgeClass(status: MarginStatus): string {
  switch (status) {
    case "at_target":
      return "bg-success-light text-foreground";
    case "acceptable_below_target":
      return "bg-warning-light text-foreground";
    case "below_minimum":
      return "bg-destructive-light text-destructive";
  }
}

export function PricingSummary({
  pricing,
  effectiveMargin,
}: PricingSummaryProps) {
  const rows = [
    ["Direct total", formatCurrency(pricing.directTotal)],
    ["Fixed additions", formatCurrency(pricing.additionsTotal)],
    ["Cost before fee", formatCurrency(pricing.costBeforeFee)],
    [
      "Royal Construction Overhead",
      formatCurrency(pricing.royalConstructionOverhead),
    ],
    ["Royal Construction Fee", formatCurrency(pricing.royalConstructionFee)],
    [
      "Total inc construction",
      formatCurrency(pricing.totalIncludingConstruction),
    ],
    ["GST", formatCurrency(pricing.gstAmount)],
  ] as const;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Live internal price stack from direct cost through margin and GST."
          icon={<ReceiptText className="size-4" aria-hidden="true" />}
          title="Pricing build-up"
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="rounded-lg bg-royal-gold-light/70 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contract value inc GST
          </p>
          <p className="font-heading text-3xl font-semibold">
            {formatCurrency(pricing.contractValueIncGst)}
          </p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {formatCurrency(pricing.perSqm, { maximumFractionDigits: 2 })} / sqm
          </p>
        </div>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono">{value}</span>
            </div>
          ))}
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Margin at selling price</p>
            <p className="text-xs text-muted-foreground">
              Reflects any manual price override
            </p>
          </div>
          <Badge
            className={getMarginBadgeClass(effectiveMargin.marginStatus)}
            variant="secondary"
          >
            {getMarginStatusLabel(effectiveMargin.marginStatus)} ·{" "}
            {formatPercent(effectiveMargin.effectiveMarkupPct)}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
