"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { LegacyWorkbookPricingSettings } from "@/lib/offer/workspace-pricing";
import {
  calculateLegacyWorkbookPricing,
  parseNonNegativeNumberInput,
} from "@/lib/offer/workspace-pricing";
import { Calculator } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency } from "./offer-workspace-format";

type LegacyPricingPanelProps = {
  readonly directTotal: number;
  readonly settings: LegacyWorkbookPricingSettings;
  readonly totalAreaSqm: number;
  readonly onSettingsChange: (
    patch: Partial<LegacyWorkbookPricingSettings>,
  ) => void;
};

export function LegacyPricingPanel({
  directTotal,
  settings,
  totalAreaSqm,
  onSettingsChange,
}: LegacyPricingPanelProps) {
  const pricing = calculateLegacyWorkbookPricing({
    directTotal,
    settings,
    totalAreaSqm,
  });

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Mirror the familiar workbook build-up so imported quotes can be checked before the customer price is selected."
          icon={<Calculator className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Pricing Fixes"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="grid gap-3 md:grid-cols-3">
          <PercentField
            label="Overhead"
            value={settings.overheadPct}
            onChange={(overheadPct) => onSettingsChange({ overheadPct })}
          />
          <PercentField
            label="RC fee"
            value={settings.royalConstructionFeePct}
            onChange={(royalConstructionFeePct) =>
              onSettingsChange({ royalConstructionFeePct })
            }
          />
          <MoneyField
            label="HBCF/home warranty"
            value={settings.hbcfInsuranceFixed}
            onChange={(hbcfInsuranceFixed) =>
              onSettingsChange({ hbcfInsuranceFixed })
            }
          />
          <MoneyField
            label="Admin"
            value={settings.adminCostFixed}
            onChange={(adminCostFixed) => onSettingsChange({ adminCostFixed })}
          />
          <MoneyField
            label="Labour"
            value={settings.labourCostFixed}
            onChange={(labourCostFixed) => onSettingsChange({ labourCostFixed })}
          />
          <MoneyField
            label="Other adjustment"
            value={settings.otherAdjustmentFixed}
            onChange={(otherAdjustmentFixed) =>
              onSettingsChange({ otherAdjustmentFixed })
            }
          />
        </div>
        <div className="rounded-lg border border-royal-gold/30 bg-royal-gold-light/70 p-3">
          <div className="grid gap-2 text-sm">
            <SummaryRow
              label="Direct quote total"
              value={formatCurrency(pricing.directTotal)}
            />
            <SummaryRow
              label="Overhead"
              value={formatCurrency(pricing.overhead)}
            />
            <SummaryRow
              label="Royal Construction fee"
              value={formatCurrency(pricing.royalConstructionFee)}
            />
            <SummaryRow
              label="Fixed additions"
              value={formatCurrency(
                pricing.hbcfInsurance +
                  pricing.adminCost +
                  pricing.labourCost +
                  pricing.otherAdjustment,
              )}
            />
            <SummaryRow
              label="Total including construction cost"
              value={formatCurrency(pricing.totalIncludingConstructionCost)}
              strong
            />
            <SummaryRow label="Legacy per sqm" value={formatCurrency(pricing.perSqm)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PercentField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        min="0"
        step="0.1"
        type="number"
        value={String(Math.round(value * 1000) / 10)}
        onChange={(event) => {
          const parsed = parseNonNegativeNumberInput(event.target.value);
          if (parsed !== null) {
            onChange(parsed / 100);
          }
        }}
      />
    </label>
  );
}

function MoneyField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Input
        min="0"
        type="number"
        value={String(value)}
        onChange={(event) => {
          const parsed = parseNonNegativeNumberInput(event.target.value);
          if (parsed !== null) {
            onChange(parsed);
          }
        }}
      />
    </label>
  );
}

function SummaryRow({
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
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-mono font-semibold" : "font-mono"}>
        {value}
      </span>
    </div>
  );
}
