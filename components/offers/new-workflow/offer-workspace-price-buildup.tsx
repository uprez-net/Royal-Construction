"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  OfferWorkspacePricing,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { Calculator } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, numberInputValue } from "./offer-workspace-format";

type PriceBuildupPanelProps = {
  readonly directTotal: number;
  readonly settings: OfferWorkspacePricingSettings;
  readonly pricing: OfferWorkspacePricing;
  readonly totalAreaSqm: number;
  readonly onSettingsChange: (
    patch: Partial<OfferWorkspacePricingSettings>,
  ) => void;
};

// The Royal quote build-up — the single source of the customer price. The Royal
// Construction charge is two additive markup levers (Overhead % + Fee %) on the
// cost base; HBCF and the impact fee are the standing fixed additions.
export function PriceBuildupPanel({
  settings,
  pricing,
  onSettingsChange,
}: PriceBuildupPanelProps) {
  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="The Royal quote build-up: direct cost plus fixed additions, marked up by the Royal Construction Overhead and Fee, then GST. This is the price shown to the client."
          icon={<Calculator className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Price build-up"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PercentField
            label="Royal Construction Overhead"
            value={settings.royalConstructionOverheadPct}
            onChange={(royalConstructionOverheadPct) =>
              onSettingsChange({ royalConstructionOverheadPct })
            }
          />
          <PercentField
            label="Royal Construction Fee"
            value={settings.royalConstructionFeePct}
            onChange={(royalConstructionFeePct) =>
              onSettingsChange({ royalConstructionFeePct })
            }
          />
          <MoneyField
            label="Home warranty / HBCF"
            value={settings.homeWarrantyHbcfFixed}
            onChange={(homeWarrantyHbcfFixed) =>
              onSettingsChange({ homeWarrantyHbcfFixed })
            }
          />
          <MoneyField
            label="Impact fee"
            value={settings.impactFeeFixed}
            onChange={(impactFeeFixed) => onSettingsChange({ impactFeeFixed })}
          />
        </div>
        <div className="rounded-lg border border-royal-gold/30 bg-royal-gold-light/70 p-3">
          <div className="grid gap-2 text-sm">
            <SummaryRow
              label="Direct quote total"
              value={formatCurrency(pricing.directTotal)}
            />
            <SummaryRow
              label="Fixed additions"
              value={formatCurrency(pricing.additionsTotal)}
            />
            <SummaryRow
              label="Cost before fee"
              value={formatCurrency(pricing.costBeforeFee)}
            />
            <SummaryRow
              label={`Royal Construction Overhead (${Math.round(
                settings.royalConstructionOverheadPct * 100,
              )}%)`}
              value={formatCurrency(pricing.royalConstructionOverhead)}
            />
            <SummaryRow
              label={`Royal Construction Fee (${Math.round(
                settings.royalConstructionFeePct * 100,
              )}%)`}
              value={formatCurrency(pricing.royalConstructionFee)}
            />
            <SummaryRow
              label="Total including construction cost"
              value={formatCurrency(pricing.totalIncludingConstruction)}
            />
            <SummaryRow label="GST" value={formatCurrency(pricing.gstAmount)} />
            <SummaryRow
              label="Contract value inc GST"
              value={formatCurrency(pricing.contractValueIncGst)}
              strong
            />
            <SummaryRow
              label="Per sqm"
              value={formatCurrency(pricing.perSqm, {
                maximumFractionDigits: 2,
              })}
            />
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
        {label} %
      </span>
      <Input
        min="0"
        max="100"
        placeholder="0"
        step="0.5"
        type="number"
        value={numberInputValue(Math.round(value * 1000) / 10)}
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
        placeholder="0"
        type="number"
        value={numberInputValue(value)}
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
