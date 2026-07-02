"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  RateCardComparison,
  RateCardProduct,
  RateCardStatus,
  RateCardTier,
} from "@/lib/offer/workspace-pricing";
import {
  RATE_CARD_PRODUCTS,
  RATE_CARD_TIERS,
} from "@/lib/offer/workspace-rate-card";
import { Gauge } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type RateCardPanelProps = {
  readonly comparison: RateCardComparison;
  readonly product: RateCardProduct;
  readonly tier: RateCardTier;
  readonly onProductChange: (value: RateCardProduct) => void;
  readonly onTierChange: (value: RateCardTier) => void;
};

const STATUS_COPY: Record<
  RateCardStatus,
  { readonly label: string; readonly className: string }
> = {
  at_or_above_target: {
    label: "At target",
    className: "bg-success-light text-foreground",
  },
  between_floor_and_target: {
    label: "Negotiate scope",
    className: "bg-warning-light text-foreground",
  },
  below_floor: {
    label: "Below floor",
    className: "bg-destructive-light text-destructive",
  },
} as const;

export function RateCardPanel({
  comparison,
  product,
  tier,
  onProductChange,
  onTierChange,
}: RateCardPanelProps) {
  const status = STATUS_COPY[comparison.status];

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Sense-check the selected Offer price against the per-sqm rate card without replacing detailed costing."
          icon={<Gauge className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Rate-card sanity check"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Product
            </span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={product}
              onChange={(event) => {
                const nextProduct = parseRateCardProduct(event.target.value);
                if (nextProduct !== null) {
                  onProductChange(nextProduct);
                }
              }}
            >
              {RATE_CARD_PRODUCTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tier
            </span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tier}
              onChange={(event) => {
                const nextTier = parseRateCardTier(event.target.value);
                if (nextTier !== null) {
                  onTierChange(nextTier);
                }
              }}
            >
              {RATE_CARD_TIERS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 rounded-lg border border-border bg-background/70 p-3 md:grid-cols-3">
          <SummaryMetric
            label="Target rate"
            value={`${formatCurrency(comparison.sellRatePerSqmIncGst)} / sqm`}
          />
          <SummaryMetric
            label="Target value"
            value={formatCurrency(comparison.targetContractValueIncGst)}
          />
          <SummaryMetric
            label="Floor value"
            value={formatCurrency(comparison.floorContractValueIncGst)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-royal-gold/30 bg-royal-gold-light/50 p-3">
          <div>
            <p className="text-sm font-medium">
              Selected price variance to target
            </p>
            <p className="font-mono text-lg font-semibold">
              {formatCurrency(comparison.varianceToTargetIncGst)}
            </p>
            <p className="text-xs text-muted-foreground">
              Floor variance {formatCurrency(comparison.varianceToFloorIncGst)}
            </p>
          </div>
          <Badge className={status.className} variant="secondary">
            {status.label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function parseRateCardProduct(value: string): RateCardProduct | null {
  switch (value) {
    case "SINGLE_STOREY":
    case "DOUBLE_STOREY":
    case "DUPLEX":
    case "KDR":
    case "GRANNY_FLAT":
      return value;
    default:
      return null;
  }
}

function parseRateCardTier(value: string): RateCardTier | null {
  switch (value) {
    case "STANDARD":
    case "MID":
    case "PREMIUM":
      return value;
    default:
      return null;
  }
}

function SummaryMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
