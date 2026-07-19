"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  OfferAreaBasis,
  OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import {
  calculateOfferArea,
  getAreaBasisTotalSqm,
} from "@/lib/offer/workspace-area";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { Info, Layers } from "lucide-react";
import type { PropsWithChildren } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, numberInputValue } from "./offer-workspace-format";

type AreaCalculatorPanelProps = {
  // Floor areas come from Job setup — the single source of truth — never
  // re-entered here.
  readonly basis: OfferAreaBasis;
  readonly area: OfferAreaCalculator;
  readonly onAreaChange: (patch: Partial<OfferAreaCalculator>) => void;
};

export function AreaCalculatorPanel({
  basis,
  area,
  onAreaChange,
}: AreaCalculatorPanelProps) {
  const calculation = calculateOfferArea(basis, area);
  const basisFields = [
    ["Ground floor", basis.groundFloorSqm],
    ["First floor", basis.firstFloorSqm],
    ["Garage", basis.garageSqm],
    ["Alfresco", basis.alfrescoSqm],
    ["Porch", basis.porchSqm],
    ["Granny flat", basis.grannyFlatSqm],
  ] as const;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="A first-principles estimate from the Job setup floor areas — set the rates and lineal measurements to size each slab, frame, brick and tile package."
            icon={<Layers className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Slab, frame, brick & tile packages"
          />
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Info className="size-3" aria-hidden="true" />
            Estimating aid — may not match the quote
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 pt-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          For understanding only — these package figures help you sanity-check
          size and cost. They are not added to the quote; the actual price comes
          from the Cost schedule line items, which may or may not line up with
          these estimates.
        </p>
        <section className="grid gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Floor areas · from Job setup
            </h3>
            <span className="text-sm font-medium">
              {getAreaBasisTotalSqm(basis)} sqm total
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {basisFields.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{value} sqm</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="grid gap-4 xl:grid-cols-3">
          <HelperSection title="Slab and drop edge">
            <NumberField
              label="Slab rate / sqm"
              value={area.slabRatePerSqm}
              onChange={(value) => onAreaChange({ slabRatePerSqm: value })}
            />
            <NumberField
              label="Drop edge lm"
              value={area.dropEdgeLinealMeters}
              onChange={(value) => onAreaChange({ dropEdgeLinealMeters: value })}
            />
            <NumberField
              label="Drop edge rate"
              value={area.dropEdgeRate}
              onChange={(value) => onAreaChange({ dropEdgeRate: value })}
            />
            <ResultRows
              rows={[
                ["Slab area", `${calculation.slabAreaSqm} sqm`],
                ["Slab cost", formatCurrency(calculation.slabCost)],
                ["Drop edge", formatCurrency(calculation.dropEdgeBeamCost)],
                ["Package", formatCurrency(calculation.slabPackageTotal)],
              ]}
            />
          </HelperSection>
          <HelperSection title="Frame">
            <NumberField
              label="GF frame rate"
              value={area.frameGroundRatePerSqm}
              onChange={(value) => onAreaChange({ frameGroundRatePerSqm: value })}
            />
            <NumberField
              label="FF frame rate"
              value={area.frameFirstRatePerSqm}
              onChange={(value) => onAreaChange({ frameFirstRatePerSqm: value })}
            />
            <NumberField
              label="Steel allowance"
              value={area.steelAllowance}
              onChange={(value) => onAreaChange({ steelAllowance: value })}
            />
            <NumberField
              label="Install allowance"
              value={area.frameInstallAllowance}
              onChange={(value) => onAreaChange({ frameInstallAllowance: value })}
            />
            <ResultRows
              rows={[
                ["GF frame", formatCurrency(calculation.frameGroundFloorCost)],
                ["FF frame", formatCurrency(calculation.frameFirstFloorCost)],
                ["Package", formatCurrency(calculation.framePackageTotal)],
              ]}
            />
          </HelperSection>
          <HelperSection title="Brick and tile">
            <NumberField
              label="Brick ground lm"
              value={area.brickGroundLinealMeters}
              onChange={(value) => onAreaChange({ brickGroundLinealMeters: value })}
            />
            <NumberField
              label="Tile area sqm"
              value={area.tileAreaSqm}
              onChange={(value) => onAreaChange({ tileAreaSqm: value })}
            />
            <NumberField
              label="Tile supply rate"
              value={area.tileSupplyRatePerSqm}
              onChange={(value) => onAreaChange({ tileSupplyRatePerSqm: value })}
            />
            <NumberField
              label="Tiler rate"
              value={area.tilerRatePerSqm}
              onChange={(value) => onAreaChange({ tilerRatePerSqm: value })}
            />
            <ResultRows
              rows={[
                ["Brick count", String(Math.round(calculation.brickCount))],
                [
                  "Sand/cement",
                  formatCurrency(
                    calculation.brickSandCost + calculation.brickCementCost,
                  ),
                ],
                ["Tile supply", formatCurrency(calculation.tileSupplyCost)],
                ["Tiler", formatCurrency(calculation.tilerCost)],
                ["Tile package", formatCurrency(calculation.tilePackageTotal)],
              ]}
            />
          </HelperSection>
        </div>
      </CardContent>
    </Card>
  );
}

function HelperSection({
  children,
  title,
}: PropsWithChildren<{ readonly title: string }>) {
  return (
    <section className="grid gap-3 rounded-lg border border-border bg-background/70 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function NumberField({
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

function ResultRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[];
}) {
  return (
    <div className="grid gap-1 border-t border-border/70 pt-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}
