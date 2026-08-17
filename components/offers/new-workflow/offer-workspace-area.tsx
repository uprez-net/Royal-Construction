"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AreaRateConstants,
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
  readonly basis: OfferAreaBasis;
  readonly area: OfferAreaCalculator;
  readonly rateConstants: AreaRateConstants;
  readonly onAreaChange: (patch: Partial<OfferAreaCalculator>) => void;
};

export function AreaCalculatorPanel({
  basis,
  area,
  rateConstants,
  onAreaChange,
}: AreaCalculatorPanelProps) {
  const calc = calculateOfferArea(basis, area, rateConstants);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Enter the estimator inputs for each section. Calculated fields update automatically from the admin rate constants."
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
        <section className="grid gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Floor areas · from Job setup
            </h3>
            <span className="text-sm font-medium">
              {getAreaBasisTotalSqm(basis)} sqm total
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <BasisRow label="Ground floor" value={basis.groundFloorSqm} />
            <BasisRow label="Void area" value={basis.voidSqm} />
            <BasisRow label="First floor" value={basis.firstFloorSqm} />
            <BasisRow label="Garage" value={basis.garageSqm} />
            <BasisRow label="Alfresco" value={basis.alfrescoSqm} />
            <BasisRow label="Porch" value={basis.porchSqm} />
            <BasisRow label="Granny flat" value={basis.grannyFlatSqm} />
            <BasisRow label="Balcony" value={basis.balconySqm} />
            <BasisRow label="Kitchen" value={basis.kitchenSqm} />
          </dl>
        </section>
        <div className="grid gap-4 xl:grid-cols-4">
          <HelperSection title="Slab">
            <div className="flex flex-col gap-2 space-x-3 mb-auto">
              <NumberField
                label="Drop edge beam surface area"
                value={area.dropEdgeBeamSurfaceArea}
                onChange={(value) =>
                  onAreaChange({ dropEdgeBeamSurfaceArea: value })
                }
              />
              <NumberField
                label="No of truck required"
                value={area.numberOfTrucks}
                onChange={(value) => onAreaChange({ numberOfTrucks: value })}
              />
            </div>
            <ResultRows
              rows={[
                [
                  "Total Drop edge beam cost",
                  formatCurrency(calc.totalDropEdgeBeamCost),
                ],
                ["Total Truck price", formatCurrency(calc.totalTruckPrice)],
                ["Total slab cost", formatCurrency(calc.slabCost)],
              ]}
            />
            <ResultRows
              rows={[["Total cost", formatCurrency(calc.totalSlabCost)]]}
            />
          </HelperSection>

          <HelperSection title="Frame">
            <div className="flex flex-col gap-2 space-x-3 mb-auto">
              <NumberField
                label="Steel Cost"
                value={area.steel}
                onChange={(value) => onAreaChange({ steel: value })}
              />
              <NumberField
                label="Installer Cost"
                value={area.installer}
                onChange={(value) => onAreaChange({ installer: value })}
              />
              <NumberField
                label="Eaves Cost"
                value={area.eaves}
                onChange={(value) => onAreaChange({ eaves: value })}
              />
            </div>
            <ResultRows
              rows={[
                [
                  "Total Ground floor area",
                  `${calc.totalGroundFloorArea.toFixed(2)} sqm`,
                ],
                [
                  "Total Ground floor frame cost",
                  formatCurrency(calc.totalGroundFloorFrameCost),
                ],
              ]}
            />
            <ResultRows
              rows={[
                [
                  "Total First floor area",
                  `${calc.totalFirstFloorArea.toFixed(2)} sqm`,
                ],
                [
                  "Total First floor frame cost",
                  formatCurrency(calc.totalFirstFloorFrameCost),
                ],
              ]}
            />
            <ResultRows
              rows={[["Total Frame cost", formatCurrency(calc.totalFrameCost)]]}
            />
          </HelperSection>

          <HelperSection title="Bricks">
            <NumberField
              label="Bricks required for Ground floor"
              value={area.bricksGroundFloor}
              onChange={(value) => onAreaChange({ bricksGroundFloor: value })}
            />
            <NumberField
              label="Bricks required for first floor"
              value={area.bricksFirstFloor}
              onChange={(value) => onAreaChange({ bricksFirstFloor: value })}
            />
            <NumberField
              label="Bricks required for pillar"
              value={area.bricksPillar}
              onChange={(value) => onAreaChange({ bricksPillar: value })}
            />
            <NumberField
              label="Tie cost"
              value={area.tieCost}
              onChange={(value) => onAreaChange({ tieCost: value })}
            />
            <ResultRows
              rows={[
                [
                  "Total bricks required",
                  String(Math.round(calc.totalBricksRequired)),
                ],
              ]}
            />
            <ResultRows
              rows={[
                [
                  "Sand required for bricks",
                  String(Math.round(calc.sandRequiredForBricks)),
                ],
                [
                  "Total cost of sand required",
                  formatCurrency(calc.totalSandCost),
                ],
              ]}
            />
            <ResultRows
              rows={[
                [
                  "Cement required for bricks",
                  String(Math.round(calc.cementRequiredForBricks)),
                ],
                [
                  "Total cost of cement required",
                  formatCurrency(calc.totalCementCost),
                ],
              ]}
            />
            <ResultRows
              rows={[
                [
                  "Total cost of materials for brick laying",
                  formatCurrency(calc.totalBrickMaterialCost),
                ],
              ]}
            />
          </HelperSection>

          <HelperSection title="Tiles">
            <div className="flex flex-col gap-2 space-x-3 mb-auto">
              <NumberField
                label="Tiles required for Ground floor"
                value={area.tilesGroundFloor}
                onChange={(value) => onAreaChange({ tilesGroundFloor: value })}
              />
              <NumberField
                label="Tiles required for all bathroom"
                value={area.tilesBathroom}
                onChange={(value) => onAreaChange({ tilesBathroom: value })}
              />
              <NumberField
                label="Tiles required for steps"
                value={area.tilesSteps}
                onChange={(value) => onAreaChange({ tilesSteps: value })}
              />
            </div>
            <ResultRows
              rows={[
                ["Tiles wasted (10%)", String(Math.round(calc.tilesWasted))],
                [
                  "Total tiles required",
                  String(Math.round(calc.totalTilesRequired)),
                ],
              ]}
            />
          </HelperSection>
        </div>
      </CardContent>
    </Card>
  );
}

function BasisRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value} sqm</dd>
    </div>
  );
}

function HelperSection({
  children,
  title,
}: PropsWithChildren<{ readonly title: string }>) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background/70 p-3">
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
          <span className="font-mono font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}
