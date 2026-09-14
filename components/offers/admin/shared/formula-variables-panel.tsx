"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AREA_MEASUREMENT_KEYS,
  DEFAULT_RATE_CONSTANTS,
  RATE_CONSTANT_KEYS,
} from "@/lib/offer/formula-variables";
import type { CostScheduleData } from "@/types/admin-offer-content";

interface RateConstantsPanelProps {
  variables: CostScheduleData["rateConstants"];
  onChange: (key: string, value: number) => void;
}

export function humanizeConstant(text: string): string {
  return text
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function FormulaVariablesPanel({
  variables,
  onChange,
}: RateConstantsPanelProps) {
  // Merge defaults with admin overrides, filtering out any retired keys that
  // may still linger in the DB from a previous schema. This guarantees every
  // key in RATE_CONSTANT_KEYS is always visible, even before the admin saves.
  const entries = RATE_CONSTANT_KEYS.map((key) => [
    key,
    variables[key] ?? DEFAULT_RATE_CONSTANTS[key],
  ]) as readonly [string, number][];

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rate constants
        </h4>
        <span className="text-xs text-muted-foreground">
          Referenced by{" "}
          <code className="font-mono">priceMode: formula</code> rows
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-center text-sm text-muted-foreground">
          No rate constants defined yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {entries.map(([key, value]) => (
            <div key={key} className="space-y-1">
              <Label
                htmlFor={`fv-${key}`}
                className="font-mono text-xs text-muted-foreground"
              >
                {humanizeConstant(key)}
              </Label>
              <Input
                id={`fv-${key}`}
                type="number"
                value={Number.isFinite(value) ? value : 0}
                onChange={(e) => onChange(key, Number(e.target.value))}
                className="font-mono"
              />
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 border-t border-border/70 pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Area measurements available in formulas (per-offer, not editable
          here):
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AREA_MEASUREMENT_KEYS.map((key) => (
            <code
              key={key}
              className="rounded-md border border-dashed border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {key}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}