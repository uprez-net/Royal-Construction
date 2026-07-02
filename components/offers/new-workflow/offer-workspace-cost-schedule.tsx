"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import { OFFER_SEQUENCE_MAPPINGS } from "@/lib/offer/workspace-sequence-mapping";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Link2,
  ListPlus,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useState, type KeyboardEvent } from "react";
import { OfferCardHeading, OfferSummaryBadge } from "./offer-workspace-card-heading";
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
  readonly onRemoveLine: (lineId: string) => void;
};

const TASK_DATALIST_ID = "offer-calculation-task-options";

function numberValue(value: number): string {
  return String(value);
}

const gridCellControlClass =
  "h-9 rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:border-royal-gold focus-visible:ring-2 focus-visible:ring-royal-gold/40 focus-visible:ring-inset";

// Auto-fits to content (base Textarea sets `field-sizing-content`): one line when
// short, grows only when the wording is long. No manual resize handle.
const gridAutoTextCellControlClass =
  "min-h-9 w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 text-sm leading-5 shadow-none focus-visible:border-royal-gold focus-visible:ring-2 focus-visible:ring-royal-gold/40 focus-visible:ring-inset";

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
  onRemoveLine,
}: CostSchedulePanelProps) {
  const includedCount = lines.filter((line) => line.includedInContract).length;
  const pricedCount = lines.filter((line) => line.costExGst > 0).length;
  const importedCount = lines.filter(
    (line) => line.sourceReference !== undefined,
  ).length;
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleExpanded = (lineId: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  };

  return (
    <Card
      className="border-border/70 bg-white/95 shadow-sm"
      aria-labelledby="cost-schedule-title"
    >
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Single editable workbook from Task-to-Sequence Mapping+lineIt. Add values against tasks to build the Offer and Tender scope."
            icon={<Rows3 className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Calculation workbook"
            titleId="cost-schedule-title"
          />
          <Button size="sm" type="button" onClick={onAddLine}>
            <Plus className="size-4" aria-hidden="true" />
            Add task
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
          <OfferSummaryBadge label="tasks" value={lines.length} />
          <OfferSummaryBadge label="priced" value={pricedCount} />
          <OfferSummaryBadge label="included" value={includedCount} />
          {importedCount > 0 ? (
            <OfferSummaryBadge label="imported" value={importedCount} />
          ) : null}
          <span className="rounded-md border border-border bg-background px-2 py-1 lg:hidden">
            Scroll sideways to review all columns
          </span>
        </div>
        <p className="sr-only" id="cost-schedule-keyboard-help">
          Use Tab and Shift Tab to move through calculation workbook cells.
          Enter moves to the next editable cell. Shift Enter moves to the
          previous editable cell.
        </p>
        <datalist id={TASK_DATALIST_ID}>
          {OFFER_SEQUENCE_MAPPINGS.map((mapping) => (
            <option key={mapping.taskName} value={mapping.taskName} />
          ))}
        </datalist>
        <div className="max-w-full overflow-hidden rounded-lg border border-border bg-card">
          <Table
            aria-describedby="cost-schedule-summary cost-schedule-keyboard-help"
            className="min-w-[1080px] table-fixed border-separate border-spacing-0 text-[13px]"
          >
            <colgroup>
              <col className="w-11" />
              <col className="w-60" />
              <col className="w-[18rem]" />
              <col />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-16" />
            </colgroup>
            <TableCaption className="sr-only">
              Editable offer calculation workbook showing task, mapped
              building sequence, Offer and Tender line item, cost excluding GST,
              inclusion status and remove action.
            </TableCaption>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 border-r border-border/70 bg-muted/60 px-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Row
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-task-column"
                >
                  Task / phase
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-sequence-column"
                >
                  Building sequence
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-offer-line-column"
                >
                  Offer/Tender line item
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-right text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-value-column"
                >
                  Value ex GST
                </TableHead>
                <TableHead
                  className="border-r border-border/70 text-center text-xs uppercase tracking-wide text-muted-foreground"
                  id="cost-included-column"
                >
                  Included
                </TableHead>
                <TableHead className="text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Remove
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="h-36 text-center" colSpan={7}>
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList
                        className="size-6 text-muted-foreground/60"
                        aria-hidden="true"
                      />
                      <p className="text-muted-foreground">
                        No tasks yet. Add one or import a workbook to start
                        the offer calculation.
                      </p>
                      <Button size="sm" type="button" variant="outline" onClick={onAddLine}>
                        <Plus className="size-4" aria-hidden="true" />
                        Add task
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {lines.map((line, index) => {
                const rowNumber = index + 1;
                const rowLabelId = `cost-row-${line.id}`;
                const rowLabel = line.itemName || `Row ${rowNumber}`;
                const isExpanded = expandedIds.has(line.id);
                const detailRowId = `cost-sequence-detail-${line.id}`;
                const stepCount = line.buildingSequenceTasks.length;

                return (
                  <Fragment key={line.id}>
                  <TableRow
                    className="group align-top hover:bg-royal-gold-light/25 focus-within:bg-royal-gold-light/35"
                  >
                    <TableCell className="sticky left-0 z-10 border-r border-border/70 bg-card px-1 py-0 align-middle group-hover:bg-royal-gold-light/25 group-focus-within:bg-royal-gold-light/35">
                      <div className="flex items-center gap-0.5">
                        <button
                          aria-controls={detailRowId}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} building sequence for ${rowLabel}`}
                          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-royal-gold-light/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-gold/40"
                          onClick={() => toggleExpanded(line.id)}
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden="true" />
                          )}
                        </button>
                        <span id={rowLabelId} className="block text-xs">
                          <span className="font-mono font-medium text-muted-foreground">
                            {rowNumber}
                          </span>
                          <span className="sr-only"> {rowLabel}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Input
                        aria-labelledby={`${rowLabelId} cost-task-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={gridCellControlClass}
                        data-cost-grid-cell=""
                        list={TASK_DATALIST_ID}
                        placeholder="Task from workbook"
                        title={line.itemName || undefined}
                        value={line.itemName}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) =>
                          onLineChange(line.id, {
                            itemName: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0 align-middle">
                      <button
                        aria-controls={detailRowId}
                        aria-expanded={isExpanded}
                        aria-labelledby={`${rowLabelId} cost-sequence-column`}
                        className={cn(
                          "flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-royal-gold/40",
                          stepCount > 0
                            ? "text-foreground hover:bg-royal-gold-light/30"
                            : "text-muted-foreground/80 hover:bg-muted/60",
                        )}
                        onClick={() => toggleExpanded(line.id)}
                        type="button"
                      >
                        {stepCount > 0 ? (
                          <>
                            <Link2
                              className="size-3.5 shrink-0 text-royal-gold"
                              aria-hidden="true"
                            />
                            <span className="font-medium">
                              {stepCount} mapped{" "}
                              {stepCount === 1 ? "step" : "steps"}
                            </span>
                          </>
                        ) : (
                          <>
                            <ListPlus
                              className="size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Add steps</span>
                          </>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0">
                      <Textarea
                        aria-labelledby={`${rowLabelId} cost-offer-line-column`}
                        aria-keyshortcuts="Enter Shift+Enter"
                        className={gridAutoTextCellControlClass}
                        data-cost-grid-cell=""
                        placeholder="Customer-visible Offer/Tender wording"
                        rows={1}
                        value={line.offerTenderLineItem}
                        onKeyDown={handleGridCellKeyDown}
                        onChange={(event) =>
                          onLineChange(line.id, {
                            offerTenderLineItem: event.target.value,
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
                            includedInContract:
                              costExGst > 0 ? true : line.includedInContract,
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/70 p-0 align-middle">
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
                    <TableCell className="p-0 align-middle">
                      <div className="flex justify-center">
                        <Button
                          aria-label={`Remove row ${rowNumber}, ${rowLabel}`}
                          className="size-8 text-muted-foreground hover:text-destructive"
                          size="icon"
                          type="button"
                          variant="ghost"
                          onClick={() => onRemoveLine(line.id)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <TableRow className="hover:bg-transparent" id={detailRowId}>
                      <TableCell className="sticky left-0 z-10 border-r border-border/70 bg-muted/20" />
                      <TableCell
                        className="border-t border-border/60 bg-muted/20 p-0"
                        colSpan={6}
                      >
                        <SequenceStepEditor
                          rowLabel={rowLabel}
                          tasks={line.buildingSequenceTasks}
                          onTasksChange={(buildingSequenceTasks) =>
                            onLineChange(line.id, { buildingSequenceTasks })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SequenceStepEditor({
  rowLabel,
  tasks,
  onTasksChange,
}: {
  readonly rowLabel: string;
  readonly tasks: readonly string[];
  readonly onTasksChange: (tasks: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const count = tasks.length;

  const addStep = () => {
    const value = draft.trim().replace(/^[-•]\s*/, "");
    if (value.length === 0 || tasks.includes(value)) {
      setDraft("");
      return;
    }
    onTasksChange([...tasks, value]);
    setDraft("");
  };

  const removeStep = (index: number) => {
    onTasksChange(tasks.filter((_, position) => position !== index));
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addStep();
    }
  };

  return (
    <div className="grid gap-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Building sequence · {count} {count === 1 ? "step" : "steps"}
        </p>
        <p className="text-xs text-muted-foreground/80">
          Downstream handoff data — not customer-facing copy
        </p>
      </div>

      {count > 0 ? (
        <ul className="grid gap-1.5">
          {tasks.map((task, index) => (
            <li
              key={task}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-[13px] leading-5"
            >
              <Link2
                className="mt-0.5 size-3.5 shrink-0 text-royal-gold"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 break-words">{task}</span>
              <button
                aria-label={`Remove step: ${task}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                onClick={() => removeStep(index)}
                type="button"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border/70 bg-background/60 px-3 py-4 text-center text-[13px] text-muted-foreground">
          No building sequence steps mapped yet. Add one below.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Input
          aria-label={`Add a building sequence step for ${rowLabel}`}
          className="h-9 flex-1 text-[13px]"
          placeholder="Add a building sequence step"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
        />
        <Button
          disabled={draft.trim().length === 0}
          size="sm"
          type="button"
          variant="outline"
          onClick={addStep}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add step
        </Button>
      </div>
    </div>
  );
}
