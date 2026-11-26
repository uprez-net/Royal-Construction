"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  calculateOfferProfitability,
  COMPANY_OVERHEAD_ALLOCATION,
  type OfferCustomerPrice,
  type OfferWorkspacePricing,
} from "@/lib/offer/workspace-pricing";
import { TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, formatPercentFixed } from "./offer-workspace-format";

type ProfitabilityPanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly pricing: OfferWorkspacePricing;
};

// What the business keeps at the price going on the offer. Internal only: it
// is computed here, on the screen, from the price and the job cost, and is
// neither saved nor handed to any customer document or email.
export function ProfitabilityPanel({
  customerPrice,
  pricing,
}: ProfitabilityPanelProps) {
  const profit = calculateOfferProfitability({
    jobCost: pricing.costBeforeFee,
    sellingContractValueIncGst: customerPrice.selectedContractValueIncGst,
    gstRate: pricing.gstRate,
  });
  const overheadPercent = formatPercentFixed(profit.companyOverheadRate)
    // "6.00%" reads as false precision on a rate nobody has set yet.
    .replace(/\.00%$/, "%");
  const overheadBasis = COMPANY_OVERHEAD_ALLOCATION.approved
    ? `${overheadPercent} of ex-GST price`
    : `illustrative ${overheadPercent} of ex-GST price, until approved`;
  const projectedLoss = profit.projectedProfitBeforeTax < 0;
  // No job cost or no price: nothing to grade, so no green "profit" either.
  const priced = profit.projectedMarginBeforeTaxPct !== null;

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Internal only, on the final price ex GST. Never on the client's documents."
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Profitability"
        />
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <ProfitRow
          label="Effective markup on job cost"
          value={formatPercentFixed(profit.effectiveMarkupPct)}
          loss={(profit.effectiveMarkupPct ?? 0) < 0}
        />
        <ProfitRow
          label="Gross profit before company overhead"
          value={formatCurrency(profit.grossProfit)}
          loss={profit.grossProfit < 0}
        />
        <ProfitRow
          label="Gross margin"
          value={formatPercentFixed(profit.grossMarginPct)}
          loss={(profit.grossMarginPct ?? 0) < 0}
        />
        <ProfitRow
          label={
            <>
              Estimated company overhead{" "}
              <span className="text-xs">({overheadBasis})</span>
            </>
          }
          value={formatCurrency(profit.companyOverhead)}
        />
        <div
          className={cn(
            "mt-1 flex flex-wrap items-baseline justify-between gap-3 rounded-lg px-3 py-2",
            !priced
              ? "bg-muted text-muted-foreground"
              : projectedLoss
                ? "bg-destructive-light text-destructive-ink"
                : "bg-success-light text-success-ink",
          )}
        >
          <span className="font-semibold">
            {projectedLoss
              ? "Projected loss before tax"
              : "Projected profit before tax"}
          </span>
          <span className="font-mono text-base font-semibold tabular-nums">
            {formatCurrency(profit.projectedProfitBeforeTax)}
            {priced
              ? ` · ${formatPercentFixed(profit.projectedMarginBeforeTaxPct)}`
              : null}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfitRow({
  label,
  loss = false,
  value,
}: {
  readonly label: ReactNode;
  readonly loss?: boolean;
  readonly value: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          loss && "font-semibold text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}
