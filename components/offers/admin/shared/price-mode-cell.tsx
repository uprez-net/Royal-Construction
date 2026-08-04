"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormulaEditor } from "@/components/shared/formula-editor";
import type { FormulaValidation } from "@/lib/offer/formula-validation";
import type {
  CostScheduleRow,
  CostScheduleRowBase,
  PriceMode,
} from "@/types/admin-offer-content";

interface PriceModeCellProps {
  row: CostScheduleRow;
  onChange: (next: CostScheduleRow) => void;
  formulaVariableKeys: readonly string[];
  /** Sample values for the live preview readout, keyed by variable name. */
  formulaSampleValues?: Record<string, number>;
  /** Streams each formula row's validation result up to the parent so the
   * Save button can be disabled while any row is invalid. */
  onFormulaValidationChange?: (rowId: string, result: FormulaValidation) => void;
}

function stripBase(row: CostScheduleRow): CostScheduleRowBase {
  const { priceMode: _priceMode, ...base } = row;
  void _priceMode;
  return base;
}

function withMode(
  base: CostScheduleRowBase,
  mode: PriceMode,
): CostScheduleRow {
  switch (mode) {
    case "none":
      return { ...base, priceMode: "none" };
    case "fixed":
      return { ...base, priceMode: "fixed", value: 0 };
    case "formula":
      return { ...base, priceMode: "formula", formula: "" };
  }
}

export function PriceModeCell({
  row,
  onChange,
  formulaVariableKeys,
  formulaSampleValues,
  onFormulaValidationChange,
}: PriceModeCellProps) {
  const base = stripBase(row);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={row.priceMode}
        onValueChange={(value) =>
          onChange(withMode(base, value as PriceMode))
        }
      >
        <SelectTrigger size="sm" className="w-28" aria-label="Price mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="fixed">Fixed</SelectItem>
          <SelectItem value="formula">Formula</SelectItem>
        </SelectContent>
      </Select>

      {row.priceMode === "none" && (
        <Input
          value="0"
          disabled
          aria-label="No value"
          className="w-24 bg-muted text-muted-foreground"
        />
      )}

      {row.priceMode === "fixed" && (
        <Input
          type="number"
          value={Number.isFinite(row.value) ? row.value : 0}
          onChange={(e) =>
            onChange({
              ...base,
              priceMode: "fixed",
              value: Number(e.target.value),
            })
          }
          aria-label="Fixed value"
          className="w-28 font-mono"
        />
      )}

      {row.priceMode === "formula" && (
        <FormulaEditor
          value={row.formula}
          variables={formulaVariableKeys}
          sampleValues={formulaSampleValues}
          onValidationChange={(result) =>
            onFormulaValidationChange?.(row.id, result)
          }
          onChange={(formula) =>
            onChange({
              ...base,
              priceMode: "formula",
              formula,
            })
          }
          ariaLabel="Formula"
          className="w-64"
        />
      )}

      <div className="flex items-center gap-1.5 pl-2">
        <Switch
          id={`include-${row.id}`}
          checked={row.defaultInclude}
          onCheckedChange={(checked) =>
            onChange({ ...row, defaultInclude: checked })
          }
          aria-label="Included by default"
        />
        <Label
          htmlFor={`include-${row.id}`}
          className="text-xs text-muted-foreground"
        >
          Inc
        </Label>
      </div>
    </div>
  );
}
