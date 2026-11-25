"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  OfferWorkspacePricing,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";
import {
  describeHbcfPremium,
  parseNonNegativeNumberInput,
  resolveTargetMarkupPct,
  HBCF_PREMIUM_GROSS_UP,
} from "@/lib/offer/workspace-pricing";
import { roundCurrency } from "@/lib/offer/pricing";
import { Calculator } from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  formatCurrency,
  formatPercentFixed,
  numberInputValue,
} from "./offer-workspace-format";
import { FIELD_LABEL_CLASS, FieldLabel } from "./offer-workspace-fields";

type PriceBuildupPanelProps = {
  readonly directTotal: number;
  readonly settings: OfferWorkspacePricingSettings;
  readonly pricing: OfferWorkspacePricing;
  readonly totalAreaSqm: number;
  // False once the offer is issued: Total Contract Value then stays at the
  // figure the premium was quoted on, and may no longer match the build-up.
  readonly totalContractValueDerived: boolean;
  readonly onSettingsChange: (
    patch: Partial<OfferWorkspacePricingSettings>,
  ) => void;
};

// The Royal quote build-up — the single source of the calculated price. The
// Royal Construction charge is two additive markups on job cost (overhead and
// builder's fee); HBCF and the impact fee are the standing fixed additions.
// Both rates are MARKUPS on job cost, not margins on the price: 20% on a
// $650,000 job is $130,000, which is 16.67% of the $780,000 it sells for.
// The profitability card under the customer price shows the margin.
export function PriceBuildupPanel({
  settings,
  pricing,
  totalContractValueDerived,
  onSettingsChange,
}: PriceBuildupPanelProps) {
  const hbcfRatePercent = Math.round(settings.hbcfRate * 100000) / 1000;
  // Effective all-in rate after GST + stamp (matches icare calculator display).
  // The loading charge sits outside it — it is a flat % of that whole premium.
  const hbcfEffectivePercent =
    Math.round(settings.hbcfRate * HBCF_PREMIUM_GROSS_UP * 100000) / 1000;
  // Split out so the estimator sees the icare figure and the loading charge
  // riding on top of it; the build-up carries only their sum (HBCF premium).
  const hbcf = describeHbcfPremium(settings);
  const hasLoadingCharge = hbcf.loadingCharge > 0;
  const totalMarkupPct = resolveTargetMarkupPct(settings);
  const totalMarkup = roundCurrency(
    pricing.royalConstructionOverhead + pricing.royalConstructionFee,
  );

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Job cost (direct cost plus fixed additions), marked up by overhead and builder's fee, then GST."
          icon={<Calculator className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Price build-up"
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Sized to the step pane, not the viewport: the pane is narrower than
            the window, so a viewport breakpoint squeezed the fields into it. */}
        <div className="grid gap-3 @xl/pane:grid-cols-3">
          <PercentField
            label="Overhead markup on job cost"
            value={settings.royalConstructionOverheadPct}
            onChange={(royalConstructionOverheadPct) =>
              onSettingsChange({ royalConstructionOverheadPct })
            }
          />
          <PercentField
            label="Builder’s fee markup on job cost"
            value={settings.royalConstructionFeePct}
            onChange={(royalConstructionFeePct) =>
              onSettingsChange({ royalConstructionFeePct })
            }
          />
          <MoneyField
            label="Impact fee"
            value={settings.impactFeeFixed}
            onChange={(impactFeeFixed) => onSettingsChange({ impactFeeFixed })}
          />
        </div>
        <div className="grid gap-2 text-sm">
          <SummaryRow
            label="Direct construction cost"
            value={formatCurrency(pricing.directTotal)}
          />
          <SummaryRow
            label="HBCF premium"
            value={formatCurrency(settings.homeWarrantyHbcfFixed)}
          />
          {settings.impactFeeFixed > 0 ? (
            <SummaryRow
              label="Impact fee"
              value={formatCurrency(settings.impactFeeFixed)}
            />
          ) : null}
          <SummaryRow
            label="Job cost before markup"
            value={formatCurrency(pricing.costBeforeFee)}
          />
          <SummaryRow
            label="Total markup on job cost"
            value={`${formatPercentFixed(totalMarkupPct)} · ${formatCurrency(totalMarkup)}`}
          />
          <div className="mt-1 border-t border-border/70 pt-2">
            <SummaryRow
              label="Calculated price incl GST"
              value={formatCurrency(pricing.contractValueIncGst, {
                maximumFractionDigits: 2,
              })}
              strong
            />
          </div>
        </div>
        <details className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40">
            Price build-up details
          </summary>
          <div className="mt-2 grid gap-2">
            <SummaryRow
              label="Fixed additions"
              value={formatCurrency(pricing.additionsTotal)}
            />
            <SummaryRow
              label={`Overhead markup (${formatPercentFixed(
                settings.royalConstructionOverheadPct,
              )})`}
              value={formatCurrency(pricing.royalConstructionOverhead)}
            />
            <SummaryRow
              label={`Builder’s fee markup (${formatPercentFixed(
                settings.royalConstructionFeePct,
              )})`}
              value={formatCurrency(pricing.royalConstructionFee)}
            />
            <SummaryRow
              label="Calculated price ex GST"
              value={formatCurrency(pricing.totalIncludingConstruction)}
            />
            <SummaryRow label="GST" value={formatCurrency(pricing.gstAmount)} />
            <SummaryRow
              label="Calculated price per sqm"
              value={formatCurrency(pricing.perSqm, {
                maximumFractionDigits: 2,
              })}
            />
            <div className="grid gap-1 border-t border-border/60 pt-2 text-xs">
              <p className={FIELD_LABEL_CLASS}>HBCF premium</p>
              {/* The premium is priced on the contract value it insures. Once
                  the offer is issued that value stays at the figure quoted,
                  and may no longer match the build-up. */}
              <p className="text-muted-foreground">
                Auto-calculated on a contract value of{" "}
                {formatCurrency(settings.hbcfTotalContractValue)}
                {totalContractValueDerived
                  ? " (the calculated price incl GST)"
                  : " (as quoted when the offer was issued)"}
                : H01 metro {hbcfRatePercent}% + GST + stamp ≈{" "}
                {hbcfEffectivePercent}%
                {hasLoadingCharge
                  ? `, plus a ${settings.loadingChargePercentage}% loading charge`
                  : ""}
                .
              </p>
              {hasLoadingCharge ? (
                <>
                  <SummaryRow
                    label="Premium (inc GST & stamp)"
                    value={formatCurrency(hbcf.premiumBeforeLoading)}
                  />
                  <SummaryRow
                    label={`Loading charge (${settings.loadingChargePercentage}%)`}
                    value={formatCurrency(hbcf.loadingCharge)}
                  />
                </>
              ) : null}
            </div>
          </div>
        </details>
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
      <FieldLabel>{label} %</FieldLabel>
      <Input
        min="0"
        max="100"
        placeholder="0"
        step="0.5"
        type="number"
        value={numberInputValue(Math.round(value * 1000) / 10)}
        onChange={(event) => {
          const parsed = parseNonNegativeNumberInput(event.target.value);
          // Reject > 100% (like the null-reject above): max="" only guards the
          // spinner, not typed/pasted input, so a fat-fingered 200 would store a
          // 2.0 (200%) markup that recalculates and autosaves live, then snaps
          // to the default on reload — a silent price change.
          if (parsed !== null && parsed <= 100) {
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
      <FieldLabel>{label}</FieldLabel>
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
