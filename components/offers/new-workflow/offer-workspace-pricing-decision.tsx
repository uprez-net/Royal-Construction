"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { AlertTriangle, BadgeDollarSign } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type PricingDecisionPanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly overrideReason: string;
  readonly priceAdjustmentLabel: string;
  readonly selectedPriceInput: string;
  readonly standardPriceInput: string;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onPriceAdjustmentLabelChange: (value: string) => void;
  readonly onSelectedPriceInputChange: (value: string) => void;
  readonly onStandardPriceInputChange: (value: string) => void;
};

export function PricingDecisionPanel({
  customerPrice,
  overrideReason,
  priceAdjustmentLabel,
  selectedPriceInput,
  standardPriceInput,
  onOverrideReasonChange,
  onPriceAdjustmentLabelChange,
  onSelectedPriceInputChange,
  onStandardPriceInputChange,
}: PricingDecisionPanelProps) {
  const standardPrice = parseNonNegativeNumberInput(standardPriceInput);
  const saving =
    standardPrice !== null
      ? standardPrice - customerPrice.selectedContractValueIncGst
      : null;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Choose the fixed inc-GST price shown to the client, with a required reason when it differs from the computed build-up."
          icon={<BadgeDollarSign className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Customer Offer price"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Standard price inc GST
            </span>
            <Input
              className="font-mono"
              inputMode="decimal"
              placeholder="Optional"
              value={standardPriceInput}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (
                  nextValue.length === 0 ||
                  parseNonNegativeNumberInput(nextValue) !== null
                ) {
                  onStandardPriceInputChange(nextValue);
                }
              }}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Price adjustment label
            </span>
            <Input
              value={priceAdjustmentLabel}
              onChange={(event) =>
                onPriceAdjustmentLabelChange(event.target.value)
              }
            />
          </label>
        </div>
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
          {saving !== null && saving > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {priceAdjustmentLabel || "Adjustment"}{" "}
              {formatCurrency(saving)}
            </p>
          ) : null}
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
            <AlertTriangle className="size-4" aria-hidden="true" />
            Add the commercial reason before sending this Offer document.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
