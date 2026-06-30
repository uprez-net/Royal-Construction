"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "./offer-workspace-format";

type PricingDecisionPanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly overrideReason: string;
  readonly selectedPriceInput: string;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onSelectedPriceInputChange: (value: string) => void;
};

export function PricingDecisionPanel({
  customerPrice,
  overrideReason,
  selectedPriceInput,
  onOverrideReasonChange,
  onSelectedPriceInputChange,
}: PricingDecisionPanelProps) {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <CardTitle>Customer Offer price</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fixed price shown on Offer document
          </span>
          <Input
            className="font-mono"
            inputMode="decimal"
            placeholder={String(customerPrice.computedContractValueIncGst)}
            value={selectedPriceInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (
                nextValue.length === 0 ||
                parseNonNegativeNumberInput(nextValue) !== null
              ) {
                onSelectedPriceInputChange(nextValue);
              }
            }}
          />
        </label>
        <div className="rounded-lg border border-border bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Computed build-up
          </p>
          <p className="font-mono text-lg font-semibold">
            {formatCurrency(customerPrice.computedContractValueIncGst)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Variance {formatCurrency(customerPrice.varianceIncGst)}
          </p>
        </div>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Override reason
          </span>
          <Textarea
            aria-invalid={customerPrice.needsOverrideReason}
            placeholder="Required only when the customer price differs from the computed build-up."
            value={overrideReason}
            onChange={(event) => onOverrideReasonChange(event.target.value)}
          />
        </label>
        {customerPrice.needsOverrideReason ? (
          <div className="md:col-span-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-light p-3 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            Add the commercial reason before sending this Offer document.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
