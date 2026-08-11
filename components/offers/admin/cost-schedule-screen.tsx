"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  costScheduleRowUpserted,
  costScheduleRowRemoved,
  rateConstantChanged,
  saveCostSchedule,
} from "@/lib/store/slices/adminOfferContentSlice";
import type { CostScheduleRow } from "@/types/admin-offer-content";
import { AREA_MEASUREMENT_KEYS } from "@/lib/offer/formula-variables";
import {
  OfferCardHeading,
  OfferSummaryBadge,
} from "@/components/offers/new-workflow/offer-workspace-card-heading";
import { Calculator, ChevronDown, Plus, Trash2 } from "lucide-react";
import { PriceModeCell } from "./shared/price-mode-cell";
import { FormulaVariablesPanel } from "./shared/formula-variables-panel";
import { SaveChangesButton } from "./shared/save-changes-button";

function newRow(phase: string): CostScheduleRow {
  return {
    id: crypto.randomUUID(),
    taskKey: `admin-${crypto.randomUUID().slice(0, 8)}`,
    phase,
    task: "",
    mapId: undefined,
    defaultInclude: true,
    priceMode: "none",
  };
}

export function OfferCostScheduleScreen() {
  const dispatch = useAppDispatch();
  const costSchedule = useAppSelector(
    (s) => s.adminOfferContent.data.costSchedule,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.costSchedule);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.costSchedule);
  const error = useAppSelector((s) => s.adminOfferContent.error.costSchedule);

  const { rows, rateConstants } = costSchedule;

  // The editor validates formulas against the union of admin-editable rate
  // constants AND per-offer area measurements. Rate constants have admin-set
  // values for the live preview; area measurements are unknown at admin time
  // (they're entered per-offer) so they only appear as valid tokens, with the
  // editor falling back to `1` for any token missing a sample value.
  const allFormulaVariables = useMemo(
    () => [...Object.keys(rateConstants), ...AREA_MEASUREMENT_KEYS],
    [rateConstants],
  );
  const formulaSampleValues = useMemo<Record<string, number>>(
    () => ({ ...rateConstants }),
    [rateConstants],
  );

  // Track validity per formula row so the Save button stays disabled until
  // every formula row parses cleanly and references only known variables/
  // functions. Keyed by row id; cleared when a row leaves formula mode.
  const [formulaValidity, setFormulaValidity] = useState<
    Map<string, boolean>
  >(() => new Map());
  const handleFormulaValidation = (rowId: string, valid: boolean) => {
    setFormulaValidity((prev) => {
      const next = new Map(prev);
      next.set(rowId, valid);
      return next;
    });
  };
  const anyFormulaInvalid = useMemo(() => {
    for (const [, valid] of formulaValidity) {
      if (!valid) return true;
    }
    return false;
  }, [formulaValidity]);

  const phases = useMemo(() => {
    const order: string[] = [];
    const byPhase = new Map<string, CostScheduleRow[]>();
    for (const row of rows) {
      if (!byPhase.has(row.phase)) {
        order.push(row.phase);
        byPhase.set(row.phase, []);
      }
      byPhase.get(row.phase)!.push(row);
    }
    return order.map((phase) => ({ phase, items: byPhase.get(phase)! }));
  }, [rows]);

  const counts = useMemo(() => {
    let none = 0;
    let fixed = 0;
    let formula = 0;
    let included = 0;
    for (const r of rows) {
      if (r.priceMode === "none") none += 1;
      else if (r.priceMode === "fixed") fixed += 1;
      else if (r.priceMode === "formula") formula += 1;
      if (r.defaultInclude) included += 1;
    }
    return { none, fixed, formula, included, total: rows.length };
  }, [rows]);

  const updateRow = (row: CostScheduleRow) =>
    dispatch(costScheduleRowUpserted(row));
  const renamePhase = (oldPhase: string, newPhase: string) => {
    for (const row of rows) {
      if (row.phase === oldPhase) {
        dispatch(costScheduleRowUpserted({ ...row, phase: newPhase }));
      }
    }
  };

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Pricing workbook tasks grouped by phase. Formula rows reference the variables in the panel below."
            icon={<Calculator className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Cost schedule"
          />
          <Button
            size="sm"
            type="button"
            onClick={() =>
              dispatch(costScheduleRowUpserted(newRow("NEW PHASE")))
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            Add phase
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <OfferSummaryBadge label="total" value={counts.total} />
          <OfferSummaryBadge label="unpriced" value={counts.none} />
          <OfferSummaryBadge label="fixed" value={counts.fixed} />
          <OfferSummaryBadge label="formula" value={counts.formula} />
          <OfferSummaryBadge label="included" value={counts.included} />
        </div>

        <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-230 table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col className="w-20" />
              <col className="w-72" />
              <col className="w-lg" />
              <col className="w-12" />
            </colgroup>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground">
                  MAP #
                </TableHead>
                <TableHead className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground">
                  Task / phase
                </TableHead>
                <TableHead className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground">
                  Price / included
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">
                  Remove
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {phases.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="h-32 text-center text-sm text-muted-foreground"
                  >
                    No cost schedule tasks yet. Add a phase to begin.
                  </TableCell>
                </TableRow>
              )}
              {phases.map(({ phase, items }) => (
                <PhaseGroup
                  key={phase}
                  phase={phase}
                  items={items}
                  formulaVariables={allFormulaVariables}
                  formulaSampleValues={formulaSampleValues}
                  onFormulaValidation={handleFormulaValidation}
                  onRenamePhase={(next) => renamePhase(phase, next)}
                  onUpdateRow={updateRow}
                  onRemoveRow={(id) => {
                    dispatch(costScheduleRowRemoved(id));
                    setFormulaValidity((prev) => {
                      if (!prev.has(id)) return prev;
                      const next = new Map(prev);
                      next.delete(id);
                      return next;
                    });
                  }}
                  onAddTask={() =>
                    dispatch(costScheduleRowUpserted(newRow(phase)))
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>

        <FormulaVariablesPanel
          variables={rateConstants}
          onChange={(key, value) =>
            dispatch(rateConstantChanged({ key, value }))
          }
        />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <SaveChangesButton
          dirty={dirty}
          saving={saving}
          disabled={anyFormulaInvalid}
          onSave={() => dispatch(saveCostSchedule())}
        />
      </CardFooter>
    </Card>
  );
}

interface PhaseGroupProps {
  phase: string;
  items: CostScheduleRow[];
  formulaVariables: readonly string[];
  formulaSampleValues: Record<string, number>;
  onFormulaValidation: (rowId: string, valid: boolean) => void;
  onRenamePhase: (next: string) => void;
  onUpdateRow: (row: CostScheduleRow) => void;
  onRemoveRow: (id: string) => void;
  onAddTask: () => void;
}

function PhaseGroup({
  phase,
  items,
  formulaVariables,
  formulaSampleValues,
  onFormulaValidation,
  onRenamePhase,
  onUpdateRow,
  onRemoveRow,
  onAddTask,
}: PhaseGroupProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={4} className="py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={expanded ? "Collapse phase" : "Expand phase"}
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
            >
              <ChevronDown
                className={
                  "size-4 transition-transform " +
                  (expanded ? "rotate-0" : "-rotate-90")
                }
                aria-hidden="true"
              />
            </button>
            <Input
              value={phase}
              onChange={(e) => onRenamePhase(e.target.value)}
              aria-label="Phase name"
              className="h-7 max-w-72 font-semibold uppercase tracking-wide"
            />
            <span className="text-xs font-normal text-muted-foreground">
              {items.length} {items.length === 1 ? "task" : "tasks"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={onAddTask}
              className="ml-auto"
            >
              <Plus className="size-3.5" />
              Add task
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded &&
        items.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="border-r border-border/70">
              <Input
                value={row.mapId === undefined ? "" : String(row.mapId)}
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdateRow({
                    ...row,
                    mapId: v === "" ? undefined : Number(v),
                  });
                }}
                placeholder="—"
                inputMode="numeric"
                aria-label="Map number"
                className="h-8 w-16"
              />
            </TableCell>
            <TableCell className="border-r border-border/70">
              <Input
                value={row.task}
                onChange={(e) => onUpdateRow({ ...row, task: e.target.value })}
                aria-label="Task description"
                className="h-8"
              />
            </TableCell>
            <TableCell className="border-r border-border/70">
              <PriceModeCell
                row={row}
                onChange={onUpdateRow}
                formulaVariableKeys={formulaVariables}
                formulaSampleValues={formulaSampleValues}
                onFormulaValidationChange={(rowId, result) =>
                  onFormulaValidation(rowId, result.valid)
                }
              />
            </TableCell>
            <TableCell>
              <button
                type="button"
                aria-label="Remove task"
                onClick={() => onRemoveRow(row.id)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
