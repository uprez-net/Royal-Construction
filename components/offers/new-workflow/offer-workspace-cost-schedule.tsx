"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  OFFER_STAGE_CATALOG,
  type OfferStageCode,
  type OfferWorkspaceCostLine,
} from "@/lib/offer/workspace-model";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { Plus, Rows3 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { WorkbookImportControl } from "./offer-workspace-import";

type CostSchedulePanelProps = {
  readonly importResult: OfferWorkbookImportResult | null;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly onImported: (result: OfferWorkbookImportResult) => void;
  readonly onLineChange: (
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) => void;
  readonly onAddLine: () => void;
};

function numberValue(value: number): string {
  return String(value);
}

const gridCellControlClass =
  "h-9 rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:border-royal-gold focus-visible:ring-2 focus-visible:ring-royal-gold/40 focus-visible:ring-inset";

const gridTextCellControlClass = cn(
  gridCellControlClass,
  "min-h-9 resize-y py-2 leading-5",
);

function focusEditableCell(element: HTMLElement) {
  element.focus();

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.select();
  }
}

function handleGridCellKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  event.preventDefault();

  const table = event.currentTarget.closest("table");
  const editableCells = Array.from(
    table?.querySelectorAll<HTMLElement>("[data-cost-grid-cell]") ?? [],
  );
  const currentIndex = editableCells.indexOf(event.currentTarget);
  const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
  const nextCell = editableCells[nextIndex];

  if (nextCell !== undefined) {
    focusEditableCell(nextCell);
  }
}

export function CostSchedulePanel({
  importResult,
  lines,
  onImported,
  onLineChange,
  onAddLine,
}: CostSchedulePanelProps) {
  const includedCount = lines.filter((line) => line.includedInContract).length;
  const importedCount = lines.filter(
    (line) => line.sourceReference !== undefined,
  ).length;

  return (
    <Card
      className="border-border/70 bg-white/95 shadow-sm"
      aria-labelledby="cost-schedule-title"
    >
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Builder-only cost rows. The customer Offer document only uses the selected total and scope summary."
            icon={<Rows3 className="size-4" aria-hidden="true" />}
            title="Internal Cost Schedule"
            titleId="cost-schedule-title"
          />
          <Button size="sm" type="button" onClick={onAddLine}>
            <Plus className="size-4" aria-hidden="true" />
            Add row
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        <WorkbookImportControl
          importResult={importResult}
          onImported={onImported}
        />
        <div
          className="flex flex-wrap gap-2 text-xs text-muted-foreground"
          id="cost-schedule-summary"
        >
          <span className="rounded-md border border-border bg-background px-2 py-1">
            {lines.length} rows
          </span>
          <span className="rounded-md border border-border bg-background px-2 py-1">
            {includedCount} included
          </span>
          {importedCount > 0 ? (
            <span className="rounded-md border border-border bg-background px-2 py-1">
              {importedCount} imported
            </span>
          ) : null}
          <span className="rounded-md border border-border bg-background px-2 py-1 md:hidden">
            Scroll sideways to review all columns
          </span>
        </div>
        <p className="sr-only" id="cost-schedule-keyboard-help">
          Use Tab and Shift Tab to move through cost schedule cells. Enter moves
          to the next editable cell. Shift Enter moves to the previous editable
          cell.
        </p>
        <div className="max-w-full overflow-hidden rounded-lg border border-border bg-card">
          <Table
            aria-describedby="cost-schedule-summary cost-schedule-keyboard-help"
            className="min-w-[920px] table-fixed border-separate border-spacing-0 text-[13px]"
          >
            <colgroup>
              <col className="w-11" />
              <col className="w-40" />
              <col className="w-[12.5rem]" />
              <col className="w-40" />
              <col />
              <col className="w-36" />
              <col className="w-24" />
            </colgroup>
            <TableCaption className="sr-only">
              Editable internal A-O cost schedule with stage, item, trade,
              notes, cost excluding GST and inclusion status.
            </TableCaption>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 border-r border-border/70 bg-muted/60 px-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Row
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-stage-column"
                >
                  Stage
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-item-column"
                >
                  Item
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-trade-column"
                >
                  Trade
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-notes-column"
                >
                  Notes
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-right text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-value-column"
                >
                  Cost ex GST
                </TableHead>
                <TableHead
                  className="text-center text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-included-column"
                >
                  Included
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="h-28 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    Add a row or import a workbook to start the internal cost
                    schedule.
                  </TableCell>
                </TableRow>
              ) : null}
              {lines.map((line, index) => {
                const rowNumber = index + 1;
                const rowLabelId = `cost-row-${line.id}`;
                const rowLabel = line.itemName || `Row ${rowNumber}`;

                return (
                  <TableRow
                    key={line.id}
                    className="group align-top hover:bg-royal-gold-light/25 focus-within:bg-royal-gold-light/35"
                  >
                    <TableCell className="sticky left-0 z-10 border-r border-border/70 bg-card px-2 py-0 align-middle group-hover:bg-royal-gold-light/25 group-focus-within:bg-royal-gold-light/35">
                      <span id={rowLabelId} className="block text-xs">
                        <span className="font-mono font-medium text-muted-foreground">
                          {rowNumber}
                        </span>
                        <span className="sr-only"> {rowLabel}</span>
                      </span>
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <StageSelect
                        label={`Stage for row ${rowNumber}, ${rowLabel}`}
                        value={line.stageCode}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(stageCode) =>
                          onLineChange(line.id, { stageCode })
                        }
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Input
                        aria-labelledby={`${rowLabelId} cost-item-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={gridCellControlClass}
                        data-cost-grid-cell=""
                        placeholder="Cost item"
                        value={line.itemName}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) =>
                          onLineChange(line.id, {
                            itemName: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Input
                        aria-labelledby={`${rowLabelId} cost-trade-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={gridCellControlClass}
                        data-cost-grid-cell=""
                        placeholder="Trade or vendor"
                        value={line.tradeOrVendor}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) =>
                          onLineChange(line.id, {
                            tradeOrVendor: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Textarea
                        aria-labelledby={`${rowLabelId} cost-notes-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={gridTextCellControlClass}
                        data-cost-grid-cell=""
                        placeholder="Specification or assumption"
                        rows={1}
                        value={line.notesOrSpec}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) =>
                          onLineChange(line.id, {
                            notesOrSpec: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Input
                        aria-labelledby={`${rowLabelId} cost-value-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={cn(gridCellControlClass, "text-right font-mono")}
                        data-cost-grid-cell=""
                        min="0"
                        type="number"
                        value={numberValue(line.costExGst)}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) => {
                          const costExGst = parseNonNegativeNumberInput(
                            event.target.value,
                          );
                          if (costExGst === null) {
                            return;
                          }

                          onLineChange(line.id, {
                            costExGst,
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="p-0 align-middle">
                      <div className="flex justify-center">
                        <Checkbox
                          aria-labelledby={`${rowLabelId} cost-included-column`}
                          aria-keyshortcuts="Enter Shift+Enter"
                          checked={line.includedInContract}
                          className="size-5 rounded-[5px] focus-visible:ring-2 focus-visible:ring-royal-gold/40"
                          data-cost-grid-cell=""
                          onKeyDown={handleGridCellKeyDown}
                          onCheckedChange={(checked) =>
                            onLineChange(line.id, {
                              includedInContract: checked === true,
                            })
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function parseStageCode(value: string): OfferStageCode | null {
  return OFFER_STAGE_CATALOG.find((stage) => stage.code === value)?.code ?? null;
}

function StageSelect({
  label,
  onChange,
  onKeyDown,
  value,
}: {
  readonly label: string;
  readonly onChange: (stageCode: OfferStageCode) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly value: OfferStageCode;
}) {
  return (
    <select
      aria-label={label}
      aria-keyshortcuts="Enter Shift+Enter"
      className={cn(
        gridCellControlClass,
        "w-full truncate outline-none",
      )}
      data-cost-grid-cell=""
      value={value}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        const stageCode = parseStageCode(event.target.value);
        if (stageCode !== null) {
          onChange(stageCode);
        }
      }}
    >
      {OFFER_STAGE_CATALOG.map((stage) => (
        <option key={stage.code} value={stage.code}>
          {stage.code} - {stage.name}
        </option>
      ))}
    </select>
  );
}
