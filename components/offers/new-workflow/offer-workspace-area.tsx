"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { OfferAreaCalculator } from "@/lib/offer/workspace-area";
import { calculateOfferArea } from "@/lib/offer/workspace-area";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { Ruler } from "lucide-react";
import type { PropsWithChildren } from "react";
import { formatCurrency } from "./offer-workspace-format";

type AreaCalculatorPanelProps = {
  readonly area: OfferAreaCalculator;
  readonly onAreaChange: (patch: Partial<OfferAreaCalculator>) => void;
};

export function AreaCalculatorPanel({
  area,
  onAreaChange,
}: AreaCalculatorPanelProps) {
  const calculation = calculateOfferArea(area);
  const areaFields = [
    ["Ground floor sqm", area.groundFloorSqm, "groundFloorSqm"],
    ["First floor sqm", area.firstFloorSqm, "firstFloorSqm"],
    ["Garage sqm", area.garageSqm, "garageSqm"],
    ["Alfresco sqm", area.alfrescoSqm, "alfrescoSqm"],
    ["Porch sqm", area.porchSqm, "porchSqm"],
    ["Granny flat sqm", area.grannyFlatSqm, "grannyFlatSqm"],
  ] satisfies readonly AreaFieldConfig[];

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex items-center gap-2">
          <Ruler className="size-4 text-royal-gold" />
          <CardTitle>Area helper calculations</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 pt-4">
        <div className="grid gap-3 md:grid-cols-3">
          {areaFields.map(([label, value, field]) => (
            <NumberField
              key={field}
              label={label}
              value={value}
              onChange={(nextValue) => onAreaChange({ [field]: nextValue })}
            />
          ))}
        </div>
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

type AreaFieldConfig = readonly [
  string,
  number,
  keyof Pick<
    OfferAreaCalculator,
    | "groundFloorSqm"
    | "firstFloorSqm"
    | "garageSqm"
    | "alfrescoSqm"
    | "porchSqm"
    | "grannyFlatSqm"
  >,
];
