"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  PILE_TYPE_LABEL,
  describePileCalculation,
  formatExtraCostCurrency,
  priceExtraCosts,
  pricePiles,
  reapplyExtraCostAdminRates,
  setFixedExtraIncluded,
  setPileType,
  setPilesIncluded,
  staleExtraCostRates,
  type ExtraCostAdminRates,
  type OfferExtraCosts,
  type OfferPilesConfig,
  type PileType,
  type PricedExtraCost,
} from "@/lib/offer/extra-costs";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { cn } from "@/lib/utils";
import { AlertTriangle, PackagePlus, RefreshCw } from "lucide-react";
import { useId, useState, type Dispatch, type SetStateAction } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { FieldLabel, GROUP_HEADING_CLASS } from "./offer-workspace-fields";

// Pump hire, benching and piles. Every edit goes through the pure helpers in
// lib/offer/extra-costs.ts, which decide when an admin rate is stamped onto the
// offer; this file only renders them.

type ExtraCostsChange = Dispatch<SetStateAction<OfferExtraCosts>>;

// ─── Slab card: Piles ───

export function SlabPilesSection({
  piles,
  adminRates,
  onExtraCostsChange,
}: {
  readonly piles: OfferPilesConfig;
  readonly adminRates: ExtraCostAdminRates;
  readonly onExtraCostsChange: ExtraCostsChange;
}) {
  const id = useId();
  const updatePiles = (
    update: (current: OfferPilesConfig) => OfferPilesConfig,
  ) =>
    onExtraCostsChange((current) => ({
      ...current,
      piles: update(current.piles),
    }));
  const priced = pricePiles(piles);
  const calculation = describePileCalculation(piles);

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid gap-3 border-t border-border/70 pt-3"
    >
      <h5 id={`${id}-heading`} className={GROUP_HEADING_CLASS}>
        Piles
      </h5>
      <div role="group" aria-labelledby={`${id}-include`}>
        <FieldLabel>
          <span id={`${id}-include`}>Include piles</span>
        </FieldLabel>
        <RadioGroup
          className="flex gap-4"
          value={piles.included ? "yes" : "no"}
          onValueChange={(value) =>
            updatePiles((current) =>
              setPilesIncluded(current, value === "yes", adminRates),
            )
          }
        >
          <RadioOption id={`${id}-include-yes`} value="yes" label="Yes" />
          <RadioOption id={`${id}-include-no`} value="no" label="No" />
        </RadioGroup>
      </div>

      {piles.included ? (
        <>
          <div role="group" aria-labelledby={`${id}-type`}>
            <FieldLabel>
              <span id={`${id}-type`}>Pile type</span>
            </FieldLabel>
            <RadioGroup
              aria-required
              className="grid gap-2"
              value={piles.type ?? ""}
              onValueChange={(value) =>
                updatePiles((current) =>
                  setPileType(current, value as PileType, adminRates),
                )
              }
            >
              {(["screw", "bored"] as const).map((type) => (
                <RadioOption
                  key={type}
                  id={`${id}-type-${type}`}
                  value={type}
                  label={PILE_TYPE_LABEL[type]}
                />
              ))}
            </RadioGroup>
          </div>

          <PileNumberField
            label="Number of piles"
            step="1"
            value={piles.quantity}
            onChange={(quantity) =>
              updatePiles((current) => ({ ...current, quantity }))
            }
          />

          {/* Only the active type's inputs are shown: a bored pile is priced by
              the metre, a screw pile by the pile. */}
          {piles.type === "bored" ? (
            <PileNumberField
              label="Length per pile (metres)"
              step="0.01"
              suffix="m"
              value={piles.lengthPerPileM}
              onChange={(lengthPerPileM) =>
                updatePiles((current) => ({ ...current, lengthPerPileM }))
              }
            />
          ) : null}

          {piles.type !== null ? (
            <PileRows
              rows={[
                [
                  "Rate (from Admin)",
                  `${formatExtraCostCurrency(piles.rate)} / ${piles.type === "screw" ? "pile" : "linear metre"}`,
                ],
                ["Calculated pile cost", calculation || "—"],
              ]}
            />
          ) : null}

          <ExtraCostIssue priced={priced} />
          {priced.amount !== null ? (
            <p className="text-xs text-muted-foreground">
              Added to the cost schedule as its own line, not to the slab total.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RadioOption({
  id,
  label,
  value,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

// A numeric field that shows what was typed while it has focus, so a count can
// be cleared and retyped, and a decimal length can pass through "8." on the
// way to "8.5", without the stored number rewriting the box under the caret.
function PileNumberField({
  label,
  onChange,
  step,
  suffix,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly step: "1" | "0.01";
  readonly suffix?: string;
  readonly value: number;
}) {
  const [editingText, setEditingText] = useState<string | null>(null);
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          className={cn("font-mono tabular-nums", suffix && "pr-10")}
          inputMode={step === "1" ? "numeric" : "decimal"}
          min="0"
          placeholder="0"
          step={step}
          type="number"
          value={editingText ?? (value === 0 ? "" : String(value))}
          onBlur={() => setEditingText(null)}
          onChange={(event) => {
            setEditingText(event.target.value);
            // Text that is not a usable number clears the stored value
            // rather than leaving the last good one priced under it: 0 is
            // refused by pricePiles, so the error shows and sending is blocked
            // until the field is corrected.
            onChange(parseNonNegativeNumberInput(event.target.value) ?? 0);
          }}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

function PileRows({
  rows,
}: {
  readonly rows: readonly (readonly [string, string])[];
}) {
  return (
    <div className="grid gap-1 border-t border-border/70 pt-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-3">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ExtraCostIssue({ priced }: { readonly priced: PricedExtraCost }) {
  if (priced.issue === null) {
    return null;
  }
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{priced.issue} Until then it adds nothing to the total.</span>
    </p>
  );
}

// ─── Cost schedule: Pump hire, Benching, and the piles line ───

export function CostScheduleExtrasPanel({
  extraCosts,
  adminRates,
  locked,
  onExtraCostsChange,
}: {
  readonly extraCosts: OfferExtraCosts;
  readonly adminRates: ExtraCostAdminRates;
  // An issued offer shows what it was priced with and offers no re-apply.
  readonly locked: boolean;
  readonly onExtraCostsChange: ExtraCostsChange;
}) {
  const priced = priceExtraCosts(extraCosts);
  const stale = locked ? [] : staleExtraCostRates(extraCosts, adminRates);
  const subtotal = [priced.pumpHire, priced.benching, priced.piles].reduce(
    (sum, item) => sum + (item.amount ?? 0),
    0,
  );
  const { piles } = extraCosts;

  return (
    <section
      aria-labelledby="cost-schedule-extras-title"
      className="grid gap-3 rounded-lg border border-border bg-background/70 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <OfferCardHeading
          description="Fixed charges priced from Admin. Each selected item is added to the total once, as its own line."
          icon={<PackagePlus className="size-4" aria-hidden="true" />}
          title="Additional cost items"
          titleId="cost-schedule-extras-title"
        />
        <span className="text-sm">
          <span className="text-muted-foreground">Subtotal </span>
          <span className="font-mono font-medium">
            {formatExtraCostCurrency(subtotal)}
          </span>
        </span>
      </div>

      <ul className="grid gap-2">
        <FixedExtraRow
          label="Pump hire"
          included={extraCosts.pumpHire.included}
          rate={
            extraCosts.pumpHire.included
              ? extraCosts.pumpHire.rate
              : adminRates.pumpHire
          }
          priced={priced.pumpHire}
          onIncludedChange={(included) =>
            onExtraCostsChange((current) => ({
              ...current,
              pumpHire: setFixedExtraIncluded(
                current.pumpHire,
                included,
                adminRates.pumpHire,
              ),
            }))
          }
        />
        <FixedExtraRow
          label="Benching"
          included={extraCosts.benching.included}
          rate={
            extraCosts.benching.included
              ? extraCosts.benching.rate
              : adminRates.benching
          }
          priced={priced.benching}
          onIncludedChange={(included) =>
            onExtraCostsChange((current) => ({
              ...current,
              benching: setFixedExtraIncluded(
                current.benching,
                included,
                adminRates.benching,
              ),
            }))
          }
        />
        {/* Piles are configured on the Slab card; listed here so the
            schedule shows every line the total carries. */}
        <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-border/80 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">
              {piles.included && piles.type !== null
                ? PILE_TYPE_LABEL[piles.type]
                : "Piles"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {piles.included
                ? describePileCalculation(piles) || "Set up on the Slab card"
                : "Not included — set up on the Slab card"}
            </span>
          </span>
          <span className="font-mono font-medium">
            {priced.piles.amount === null
              ? "—"
              : formatExtraCostCurrency(priced.piles.amount)}
          </span>
        </li>
      </ul>

      {stale.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-royal-gold/40 bg-royal-gold-light/30 px-3 py-2 text-xs">
          <span>
            Admin prices have changed since they were applied to this offer:{" "}
            {stale
              .map(
                (item) =>
                  `${item.label} ${formatExtraCostCurrency(item.applied)} → ${formatExtraCostCurrency(item.current)}`,
              )
              .join("; ")}
            .
          </span>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() =>
              onExtraCostsChange((current) =>
                reapplyExtraCostAdminRates(current, adminRates),
              )
            }
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Apply current prices
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function FixedExtraRow({
  included,
  label,
  onIncludedChange,
  priced,
  rate,
}: {
  readonly included: boolean;
  readonly label: string;
  readonly onIncludedChange: (included: boolean) => void;
  readonly priced: PricedExtraCost;
  // The applied rate while included; today's admin price while not, so the
  // estimator sees what ticking it would add.
  readonly rate: number;
}) {
  const id = useId();
  return (
    <li className="grid gap-1 rounded-md border border-border/70 px-3 py-2 text-sm">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
        <Checkbox
          id={id}
          checked={included}
          className="size-5 rounded-[5px]"
          onCheckedChange={(checked) => onIncludedChange(checked === true)}
        />
        <Label htmlFor={id} className="font-medium">
          {label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {included ? "Applicable" : "Not applicable"} ·{" "}
            {formatExtraCostCurrency(rate)} fixed
          </span>
        </Label>
        <span
          className={cn(
            "font-mono font-medium",
            !included && "text-muted-foreground",
          )}
        >
          {priced.amount === null
            ? "—"
            : formatExtraCostCurrency(priced.amount)}
        </span>
      </div>
      <ExtraCostIssue priced={priced} />
    </li>
  );
}
