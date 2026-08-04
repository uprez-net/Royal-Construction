"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CostScheduleData } from "@/types/admin-offer-content";

interface FormulaVariablesPanelProps {
  variables: CostScheduleData["formulaVariables"];
  onChange: (key: string, value: number) => void;
}

export function FormulaVariablesPanel({
  variables,
  onChange,
}: FormulaVariablesPanelProps) {
  const entries = Object.entries(variables);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Formula variables
        </h4>
        <span className="text-xs text-muted-foreground">
          Referenced by{" "}
          <code className="font-mono">priceMode: formula</code> rows
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-center text-sm text-muted-foreground">
          No formula variables defined yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {entries.map(([key, value]) => (
            <div key={key} className="space-y-1">
              <Label
                htmlFor={`fv-${key}`}
                className="font-mono text-xs text-muted-foreground"
              >
                {key}
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
    </div>
  );
}
