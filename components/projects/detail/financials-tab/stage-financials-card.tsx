"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createExpandedRowModel,
  createFilteredRowModel,
  globalFilteringFeature,
  rowExpandingFeature,
  tableFeatures,
  useTable,
  type ExpandedState,
  type FilterFn,
  type OnChangeFn,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FilePlus2,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  FinancialActivity,
  FinancialStage,
} from "@/lib/domain/projects/financial-report";
import {
  activityMatches,
  type FinancialFilter,
} from "@/lib/projects/financial-filters";
import { cn } from "@/lib/utils";
import { PROJECT_STAGE_LABELS } from "@/types/project";
import { formatStatus } from "@/utils/formatters";

import { ActivityDetail, type InvoiceActions } from "./activity-detail";
import { ActivityPriceCell } from "./activity-price-cell";
import {
  formatCents,
  MoneyWithGst,
  outcomeRowClass,
  ProfitLoss,
} from "./money";

/** An activity as the table holds it: with the names above it, for search. */
type FinancialRow = {
  readonly activity: FinancialActivity;
  readonly ancestors: readonly string[];
  readonly subRows: readonly FinancialRow[];
};

function toRows(
  activities: readonly FinancialActivity[],
  ancestors: readonly string[] = [],
): FinancialRow[] {
  return activities.map((activity) => ({
    activity,
    ancestors,
    subRows: toRows(activity.children, [...ancestors, activity.name]),
  }));
}

// Stable at module scope, as Table v9 asks: a new features object or column
// list each render would rebuild every row model.
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowExpandingFeature,
  filteredRowModel: createFilteredRowModel(),
  expandedRowModel: createExpandedRowModel(),
});

const helper = createColumnHelper<typeof features, FinancialRow>();

/** The tab's filter, applied to the row's activity and the tree around it. */
const motherFilter: FilterFn<typeof features, FinancialRow> = (
  row,
  _columnId,
  filter: FinancialFilter,
) => activityMatches(row.original.activity, filter, row.original.ancestors);

const NUMERIC = "text-right whitespace-nowrap";

function columnsFor(
  onVariation: InvoiceActions["onVariation"],
  onPrice: InvoiceActions["onPrice"],
) {
  return helper.columns([
    helper.accessor((row) => row.activity.name, {
      id: "activity",
      header: "Activity",
      cell: ({ row }) => {
        const { activity } = row.original;
        const canExpand = row.getCanExpand();
        const expanded = row.getIsExpanded();
        return (
          <div
            className="flex items-start gap-2"
            style={{ paddingLeft: `${row.depth * 1.25}rem` }}
          >
            {canExpand ? (
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Hide" : "Show"} ${activity.name} details`}
                className="-m-1 mt-0 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {expanded ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="size-5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                {activity.name}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {activity.children.length ? (
                  <span>
                    {activity.children.length} sub-activit
                    {activity.children.length === 1 ? "y" : "ies"} ·
                    consolidated
                  </span>
                ) : null}
                {activity.status === "NOT_REQUIRED"
                || activity.status === "DONE" ? (
                  <span>{formatStatus(activity.status)}</span>
                ) : null}
                {activity.figures.overInvoiced ? (
                  <span className="inline-flex items-center gap-1 font-medium text-destructive-ink">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    Invoiced exceeds quoted
                  </span>
                ) : null}
                {activity.figures.quoteMissing ? (
                  <span className="font-medium text-warning-ink">
                    Quote missing
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        );
      },
    }),
    helper.display({
      id: "tender",
      header: "Quoted price",
      cell: ({ row }) => (
        <ActivityPriceCell activity={row.original.activity} onSave={onPrice} />
      ),
    }),
    helper.display({
      id: "quoted",
      header: "Tradie quoted",
      cell: ({ row }) => {
        const { figures } = row.original.activity;
        return (
          <MoneyWithGst
            cents={figures.quotedCents}
            gstCents={figures.quotedGstCents}
            muted={figures.quotedCents === 0}
          />
        );
      },
    }),
    helper.display({
      id: "invoiced",
      header: "Total invoiced",
      cell: ({ row }) => {
        const { figures } = row.original.activity;
        return (
          <MoneyWithGst
            cents={figures.invoicedCents}
            gstCents={figures.invoicedGstCents}
            muted={figures.invoicedCents === 0}
          />
        );
      },
    }),
    helper.display({
      id: "profit",
      header: "Profit/Loss",
      cell: ({ row }) => <ProfitLoss figures={row.original.activity.figures} />,
    }),
    helper.display({
      id: "variation",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onVariation(row.original.activity.id)}
          aria-label={`Create a variation for ${row.original.activity.name}`}
          title="Create variation"
        >
          <FilePlus2 className="size-4" aria-hidden="true" />
          <span className="hidden xl:inline">Variation</span>
        </Button>
      ),
    }),
  ]);
}

// The stage header's figures sit in the same fixed widths as these columns, so
// a figure keeps its place whether a stage is open, closed or has long notes.
const METRIC_WIDTH = {
  tender: "lg:w-40",
  quoted: "lg:w-36",
  invoiced: "lg:w-36",
  profit: "lg:w-48",
  action: "lg:w-28",
} as const;

const COLUMN_CLASS: Record<string, string> = {
  activity: "min-w-64",
  invoiced: `${NUMERIC} w-36`,
  profit: `${NUMERIC} w-48`,
  quoted: `${NUMERIC} w-36`,
  tender: `${NUMERIC} w-40`,
  variation: "w-28 text-right whitespace-nowrap",
};

function StageMetric({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex flex-col gap-0.5 text-sm lg:items-end lg:text-right",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

/**
 * One stage of the build: a collapsible card holding its activities, each a
 * row that opens onto its bookings and invoices, and a parent's row onto its
 * sub-activities as well, with the parent showing their consolidated figures.
 *
 * Expansion is the tab's, not the card's, so Expand all reaches every stage.
 */
export function StageFinancialsCard({
  stage,
  filter,
  open,
  onOpenChange,
  expanded,
  onExpandedChange,
  actions,
}: {
  stage: FinancialStage;
  filter: FinancialFilter | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expanded: ExpandedState;
  onExpandedChange: OnChangeFn<ExpandedState>;
  actions: InvoiceActions;
}) {
  // Out of the React Compiler. The rows and cells Table hands back are the
  // same objects from one render to the next while their expansion changes,
  // so a memoised `<FlexRender cell={cell} />` would keep showing a chevron
  // the row has already toggled. TanStack's own guidance for the compiler.
  "use no memo";
  const data = useMemo(() => toRows(stage.activities), [stage.activities]);
  const columns = useMemo(
    () => columnsFor(actions.onVariation, actions.onPrice),
    [actions.onVariation, actions.onPrice],
  );
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.activity.id,
    getSubRows: (row) => [...row.subRows],
    getRowCanExpand: (row) =>
      row.subRows.length > 0 || row.original.activity.bookings.length > 0,
    getColumnCanGlobalFilter: (column) => column.id === "activity",
    globalFilterFn: motherFilter,
    state: { expanded, globalFilter: filter },
    onExpandedChange,
  });
  const rows = table.getRowModel().rows;
  if (filter && rows.length === 0) return null;

  const label = PROJECT_STAGE_LABELS[stage.stage];
  const { figures, price } = stage;
  // Positive: the activities leave part of the stage price unassigned.
  const unallocatedCents = price ? price.exGstCents - stage.allocatedCents : 0;
  const contentId = `financials-stage-${stage.stage}`;

  return (
    <Card className="gap-0 overflow-hidden bg-card py-0 shadow-sm">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-controls={contentId}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:pl-5 sm:pr-3"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {open ? (
                  <ChevronDown
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="font-heading text-lg font-semibold text-foreground">
                  {label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {stage.activities.length} activit
                  {stage.activities.length === 1 ? "y" : "ies"}
                </span>
                {figures.overInvoiced ? (
                  <StatusPill tone="danger">Invoiced exceeds quoted</StatusPill>
                ) : null}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">
                {price
                  ? `${
                      price.percentage !== null
                        ? `${price.percentage}% of contract`
                        : "Contract claim"
                    }${
                      price.gstIncluded
                        ? ` · ${formatCents(price.claimCents)} inc GST`
                        : ""
                    }${
                      stage.variationCents > 0
                        ? ` · incl. +${formatCents(stage.variationCents)} variations`
                        : ""
                    }`
                  : "No contract claim · sum of activities"}
              </span>
              {price && unallocatedCents !== 0 ? (
                <span
                  className={cn(
                    "pl-6 text-xs font-medium",
                    unallocatedCents < 0
                      ? "text-destructive-ink"
                      : "text-warning-ink",
                  )}
                >
                  {unallocatedCents > 0
                    ? `${formatCents(unallocatedCents)} not allocated to an activity`
                    : `Activities over by ${formatCents(-unallocatedCents)}`}
                </span>
              ) : null}
            </span>
            <span className="grid w-full grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:flex lg:w-auto lg:items-start lg:gap-x-0">
              <StageMetric label="Quoted price" className={METRIC_WIDTH.tender}>
                <MoneyWithGst
                  cents={figures.tenderCents}
                  gstCents={figures.tenderGstCents}
                />
              </StageMetric>
              <StageMetric
                label="Tradie quoted"
                className={METRIC_WIDTH.quoted}
              >
                <MoneyWithGst
                  cents={figures.quotedCents}
                  gstCents={figures.quotedGstCents}
                />
              </StageMetric>
              <StageMetric
                label="Total invoiced"
                className={METRIC_WIDTH.invoiced}
              >
                <MoneyWithGst
                  cents={figures.invoicedCents}
                  gstCents={figures.invoicedGstCents}
                />
              </StageMetric>
              <StageMetric label="Profit/Loss" className={METRIC_WIDTH.profit}>
                <ProfitLoss figures={figures} />
              </StageMetric>
              <span
                className={cn("hidden lg:block", METRIC_WIDTH.action)}
                aria-hidden="true"
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent id={contentId}>
          <div className="overflow-x-auto border-t border-border/70">
            <table className="w-full min-w-[64rem] table-fixed caption-bottom text-sm">
              <caption className="sr-only">
                {label} activities: quoted price, tradie quotes, invoices and
                profit or loss
              </caption>
              <thead className="bg-muted/40">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id} className="border-b border-border/70">
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className={cn(
                          "h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground",
                          COLUMN_CLASS[header.column.id],
                        )}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { activity } = row.original;
                  const showDetail =
                    row.getIsExpanded()
                    && (activity.bookings.length > 0
                      || row.subRows.length === 0);
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn(
                          "border-b border-border/70 transition-colors",
                          outcomeRowClass(activity.figures.outcome),
                          !outcomeRowClass(activity.figures.outcome)
                            && "hover:bg-muted/40",
                        )}
                      >
                        {row.getAllCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={cn(
                              "px-3 py-2.5 align-top",
                              COLUMN_CLASS[cell.column.id],
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        ))}
                      </tr>
                      {showDetail ? (
                        <tr className="border-b border-border/70 bg-muted/30">
                          <td
                            colSpan={columns.length}
                            className="px-3 py-3"
                            style={{
                              paddingLeft: `${row.depth * 1.25 + 2.5}rem`,
                            }}
                          >
                            <ActivityDetail
                              actions={actions}
                              bookings={activity.bookings}
                              hasChildren={row.subRows.length > 0}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
