"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  OfferCustomerPrice,
  OfferWorkspacePricing,
} from "@/lib/offer/workspace-pricing";
import {
  parseNonNegativeNumberInput,
  splitContractValueByGst,
} from "@/lib/offer/workspace-pricing";
import { AlertTriangle, BadgeDollarSign } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, formatMoneyDelta } from "./offer-workspace-format";
import { FieldLabel } from "./offer-workspace-fields";

type PricingDecisionPanelProps = {
  readonly customerPrice: OfferCustomerPrice;
  readonly pricing: OfferWorkspacePricing;
  readonly overrideReason: string;
  readonly priceAdjustmentLabel: string;
  readonly selectedPriceInput: string;
  readonly standardPriceInput: string;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onPriceAdjustmentLabelChange: (value: string) => void;
  readonly onSelectedPriceInputChange: (value: string) => void;
  readonly onStandardPriceInputChange: (value: string) => void;
};

const CENTS = { maximumFractionDigits: 2 } as const;

export function PricingDecisionPanel({
  customerPrice,
  pricing,
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
  // The split the save stores on Offer.amount / gstAmount / totalAmount, so the
  // figures here are the ones the offer record will carry.
  const finalPrice = splitContractValueByGst({
    contractValueIncGst: customerPrice.selectedContractValueIncGst,
    gstRate: pricing.gstRate,
  });

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="The fixed price on the client's Offer document. A change from the calculated price needs a reason."
          icon={<BadgeDollarSign className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Customer offer price"
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <label>
          <FieldLabel>Final price incl GST</FieldLabel>
          <Input
            className="h-14 font-mono text-2xl font-semibold tabular-nums md:text-2xl"
            inputMode="decimal"
            placeholder={String(customerPrice.computedContractValueIncGst)}
            value={selectedPriceInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (
                nextValue.length === 0
                || parseNonNegativeNumberInput(nextValue) !== null
              ) {
                onSelectedPriceInputChange(nextValue);
              }
            }}
          />
          {selectedPriceInput.trim()
          !== String(customerPrice.computedContractValueIncGst) ? (
            <button
              className="mt-1 text-xs font-medium text-royal-gold-ink-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
              onClick={() =>
                onSelectedPriceInputChange(
                  String(customerPrice.computedContractValueIncGst),
                )
              }
              type="button"
            >
              Use calculated price ·{" "}
              {formatCurrency(customerPrice.computedContractValueIncGst, CENTS)}
            </button>
          ) : null}
        </label>
        <div className="grid gap-2 text-sm">
          <PriceRow
            label="Calculated price incl GST"
            value={formatCurrency(
              customerPrice.computedContractValueIncGst,
              CENTS,
            )}
          />
          {customerPrice.hasManualOverride ? (
            <PriceRow
              label="Difference from calculated price"
              value={formatMoneyDelta(customerPrice.varianceIncGst)}
            />
          ) : null}
          <div className="mt-1 grid gap-2 border-t border-border/70 pt-2">
            <PriceRow
              label="Final price ex GST"
              value={formatCurrency(finalPrice.amountExGst, CENTS)}
            />
            <PriceRow
              label="GST"
              value={formatCurrency(finalPrice.gstAmount, CENTS)}
            />
            <PriceRow
              label="Final price incl GST"
              value={formatCurrency(finalPrice.totalIncGst, CENTS)}
              strong
            />
          </div>
        </div>
        <label>
          <FieldLabel>Adjustment reason</FieldLabel>
          <Textarea
            aria-invalid={customerPrice.needsOverrideReason}
            placeholder="Required only when the final price differs from the calculated price."
            value={overrideReason}
            onChange={(event) => onOverrideReasonChange(event.target.value)}
          />
        </label>
        {customerPrice.needsOverrideReason ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-light p-3 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Add the commercial reason before sending this Offer document.
          </div>
        ) : null}
        {/* The "was" price the document can show beside the final price, and
            what it calls the difference. Optional, so it sits below. */}
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <FieldLabel>Standard price incl GST</FieldLabel>
            <Input
              className="font-mono"
              inputMode="decimal"
              placeholder="Optional"
              value={standardPriceInput}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (
                  nextValue.length === 0
                  || parseNonNegativeNumberInput(nextValue) !== null
                ) {
                  onStandardPriceInputChange(nextValue);
                }
              }}
            />
            {saving !== null && saving > 0 ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {priceAdjustmentLabel || "Adjustment"} {formatCurrency(saving)}
              </span>
            ) : null}
          </label>
          <label>
            <FieldLabel>Price adjustment label</FieldLabel>
            <Input
              value={priceAdjustmentLabel}
              onChange={(event) =>
                onPriceAdjustmentLabelChange(event.target.value)
              }
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function PriceRow({
  label,
  strong = false,
  value,
}: {
  readonly label: string;
  readonly strong?: boolean;
  readonly value: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "font-mono font-semibold tabular-nums"
            : "font-mono tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
