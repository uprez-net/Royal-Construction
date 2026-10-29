"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  functionalUpdate,
  type ExpandedState,
  type Updater,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebounce } from "@/hooks/use-debounce";
import {
  allocateTradieInvoiceAction,
  fetchProjectFinancials,
  type ProjectFinancialsResult,
} from "@/lib/data/project-financials";
import type {
  FinancialActivity,
  FinancialBooking,
  FinancialInvoice,
} from "@/lib/domain/projects/financial-report";
import type { ProjectFinancials } from "@/lib/domain/projects/financials";
import {
  countMatches,
  FINANCIAL_VIEW_LABELS,
  FINANCIAL_VIEWS,
  isFilterActive,
  isFinancialView,
  type FinancialFilter,
} from "@/lib/projects/financial-filters";
import { PROJECT_STAGE_LABELS, type ProjectDetail } from "@/types/project";
import type { ProjectStage } from "@prisma/client";

import { ActivityDetail, InvoiceList } from "./activity-detail";
import { formatCents, Money, ProfitLoss } from "./money";
import {
  RecordInvoiceDialog,
  type BookingOption,
} from "./record-invoice-dialog";
import { StageFinancialsCard } from "./stage-financials-card";
import { RecheckInvoiceDialog } from "./recheck-invoice-dialog";
import { VoidInvoiceDialog } from "./void-invoice-dialog";

// The filter lives in the URL, so a filtered view can be shared and survives
// a reload; the search box writes to it once typing settles.
const PARAM = { search: "fq", tradie: "ftradie", view: "fview" } as const;

function financialsKey(projectId: string) {
  return ["project-financials", projectId] as const;
}

function walk(
  activities: readonly FinancialActivity[],
  visit: (activity: FinancialActivity, path: readonly string[]) => void,
  path: readonly string[] = [],
) {
  for (const activity of activities) {
    visit(activity, path);
    walk(activity.children, visit, [...path, activity.name]);
  }
}

/** Every booking the report shows, wherever it sits. */
function allBookings(report: ProjectFinancials) {
  const rows: { booking: FinancialBooking; where: string }[] = [];
  for (const stage of report.stages) {
    walk(stage.activities, (activity, path) => {
      for (const booking of activity.bookings) {
        rows.push({
          booking,
          where: [
            PROJECT_STAGE_LABELS[stage.stage],
            ...path,
            activity.name,
          ].join(" › "),
        });
      }
    });
  }
  for (const booking of report.unassigned.bookings) {
    rows.push({ booking, where: "No activity" });
  }
  return rows;
}

function bookingOptions(report: ProjectFinancials): BookingOption[] {
  return allBookings(report).map(({ booking, where }) => ({
    id: booking.id,
    label: `${booking.tradieName} — ${where}`,
    tradieId: booking.tradieId,
  }));
}

/**
 * The project's profit and loss, activity by activity (issue #405).
 *
 * One card per build stage, each a table of its activities; an activity opens
 * onto its bookings and their invoices, a parent onto its sub-activities too.
 * The filter on top applies to every stage at once. Figures come from the
 * domain report whole — this screen adds nothing up itself.
 */
export function ProjectFinancialsTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: financialsKey(project.id),
    // Fresh each time the tab is opened: bookings and invoices change from the
    // Tradies tab, Eve and the Xero webhook, none of which can reach this cache.
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const result = await fetchProjectFinancials(project.id);
      if (!result.ok) throw new Error(result.error);
      return result.report;
    },
  });

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParam = searchParams.get(PARAM.search) ?? "";
  const tradieParam = searchParams.get(PARAM.tradie);
  const viewParam = searchParams.get(PARAM.view);
  // One object per URL, not per render: it is the table's global filter, and
  // a new one each render would have every stage filter its rows again.
  const filter = useMemo<FinancialFilter>(
    () => ({
      search: searchParam,
      tradieId: tradieParam,
      view: isFinancialView(viewParam) ? viewParam : "all",
    }),
    [searchParam, tradieParam, viewParam],
  );
  const [searchBox, setSearchBox] = useState(filter.search);
  const debouncedSearch = useDebounce(searchBox, 250);

  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [closedStages, setClosedStages] = useState<ReadonlySet<ProjectStage>>(
    () => new Set(),
  );
  const [recordFor, setRecordFor] = useState<string | null | undefined>(
    undefined,
  );
  const [voiding, setVoiding] = useState<FinancialInvoice | null>(null);
  const [recheckFor, setRecheckFor] = useState<string | null>(null);

  // The browser's replaceState rather than router.replace: the tab loads its
  // own data, so a keystroke must not re-render the server page. Next keeps
  // useSearchParams in step with it.
  function writeParams(
    changes: Partial<Record<keyof typeof PARAM, string | null>>,
  ) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      const name = PARAM[key as keyof typeof PARAM];
      if (value) params.set(name, value);
      else params.delete(name);
    }
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    const typed = debouncedSearch.trim();
    if (
      typed
      === (new URLSearchParams(window.location.search).get(PARAM.search) ?? "")
    )
      return;
    writeParams({ search: typed || null });
    // Only the typing drives this; see projects-client.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const report = query.data;
  const active = isFilterActive(filter);
  const globalFilter = active ? filter : undefined;

  const counts = useMemo(
    () =>
      report
        ? countMatches(
            report.stages.flatMap((stage) => stage.activities),
            filter,
          )
        : { shown: 0, total: 0 },
    [report, filter],
  );

  const tradies = useMemo(() => {
    if (!report) return [];
    const seen = new Map<string, string>();
    for (const { booking } of allBookings(report)) {
      seen.set(booking.tradieId, booking.tradieName);
    }
    for (const invoice of report.unallocatedInvoices) {
      seen.set(invoice.tradieId, invoice.tradieName);
    }
    return [...seen]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [report]);

  const options = useMemo(
    () => (report ? bookingOptions(report) : []),
    [report],
  );

  function applyResult(result: Extract<ProjectFinancialsResult, { ok: true }>) {
    queryClient.setQueryData(financialsKey(project.id), result.report);
  }

  async function allocate(invoice: FinancialInvoice, scheduleId: string) {
    try {
      const result = await allocateTradieInvoiceAction({
        invoiceId: invoice.id,
        projectId: project.id,
        scheduleId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      applyResult(result);
      toast.success("Invoice allocated.");
    } catch {
      toast.error("The invoice could not be allocated. Try again.");
    }
  }

  const actions = {
    onRecord: (scheduleId: string) => setRecordFor(scheduleId),
    onVoid: (invoice: FinancialInvoice) => setVoiding(invoice),
    onRecheck: (scheduleId: string) => setRecheckFor(scheduleId),
  };

  const onExpandedChange = (updater: Updater<ExpandedState>) =>
    setExpanded((previous) => functionalUpdate(updater, previous));

  if (query.isPending) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 py-10 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Working out the project&apos;s profit and loss…
      </p>
    );
  }
  if (query.isError || !report) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Financials could not be loaded</AlertTitle>
        <AlertDescription>
          <p>{query.error?.message ?? "Something went wrong."}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { totals } = report;
  const allExpanded = expanded === true;

  return (
    <div className="space-y-4">
      {/* The filter for every stage at once. */}
      <Card className="gap-3 bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchBox}
              onChange={(event) => {
                const next = event.target.value;
                // A search reaches into collapsed parents, so open them
                // as it starts.
                if (next.trim() && !searchBox.trim()) setExpanded(true);
                setSearchBox(next);
              }}
              placeholder="Search activities, tradies or invoice numbers"
              aria-label="Search activities, tradies or invoice numbers"
              className="pl-9"
            />
          </div>
          <Select
            value={filter.tradieId ?? "all"}
            onValueChange={(value) => {
              writeParams({ tradie: value === "all" ? null : value });
              if (value !== "all") setExpanded(true);
            }}
          >
            <SelectTrigger className="w-full lg:w-56" aria-label="Tradie">
              <SelectValue placeholder="All tradies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tradies</SelectItem>
              {tradies.map((tradie) => (
                <SelectItem key={tradie.id} value={tradie.id}>
                  {tradie.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExpanded(allExpanded ? {} : true)}
            >
              {allExpanded ? (
                <ChevronsDownUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronsUpDown className="size-4" aria-hidden="true" />
              )}
              {allExpanded ? "Collapse all" : "Expand all"}
            </Button>
            <Button
              type="button"
              onClick={() => setRecordFor(null)}
              disabled={options.length === 0}
            >
              <Plus className="size-4" aria-hidden="true" />
              Record invoice
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter.view}
            onValueChange={(value) => {
              if (!value) return;
              writeParams({ view: value === "all" ? null : value });
              if (value !== "all") setExpanded(true);
            }}
            aria-label="Show"
            className="flex-wrap"
          >
            {FINANCIAL_VIEWS.map((view) => (
              <ToggleGroupItem key={view} value={view}>
                {FINANCIAL_VIEW_LABELS[view]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {active ? (
            <p className="text-sm text-muted-foreground" role="status">
              Showing {counts.shown} of {counts.total} activities
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => {
                  setSearchBox("");
                  writeParams({ search: null, tradie: null, view: null });
                }}
              >
                Clear filters
              </Button>
            </p>
          ) : null}
        </div>
      </Card>

      {report.unallocatedInvoices.length > 0 ? (
        <SectionCard
          title="Invoices to allocate"
          description="From Xero, on this project, but not matched to one booking. They count in the totals below and in no activity until they are put against the booking they bill."
          titleAs="h3"
        >
          <ul className="space-y-3">
            {report.unallocatedInvoices.map((invoice) => {
              const choices = options.filter(
                (option) => option.tradieId === invoice.tradieId,
              );
              return (
                <li key={invoice.id} className="space-y-2">
                  <InvoiceList invoices={[invoice]} onVoid={actions.onVoid} />
                  <Select
                    onValueChange={(value) => void allocate(invoice, value)}
                  >
                    <SelectTrigger
                      className="w-full sm:w-96"
                      aria-label={`Allocate invoice ${invoice.invoiceNumber ?? ""} to a booking`}
                      disabled={choices.length === 0}
                    >
                      <SelectValue
                        placeholder={
                          choices.length
                            ? "Allocate to a booking…"
                            : `${invoice.tradieName} has no booking on this project`
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      {report.stages.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          This project has no activities yet, so there is nothing to compare.
        </p>
      ) : null}

      {report.stages.map((stage) => (
        <StageFinancialsCard
          key={stage.stage}
          stage={stage}
          filter={globalFilter}
          open={active || !closedStages.has(stage.stage)}
          onOpenChange={(open) =>
            setClosedStages((previous) => {
              const next = new Set(previous);
              if (open) next.delete(stage.stage);
              else next.add(stage.stage);
              return next;
            })
          }
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          actions={actions}
        />
      ))}

      {active && counts.shown === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No activity matches these filters.
        </p>
      ) : null}

      {report.unassigned.bookings.length > 0 && !active ? (
        <SectionCard
          title="Bookings on no activity"
          description="Committed or invoiced, but not booked against an activity, so there is no tender to set them against."
          titleAs="h3"
        >
          <ActivityDetail
            actions={actions}
            bookings={report.unassigned.bookings}
            hasChildren={false}
          />
        </SectionCard>
      ) : null}

      {/* The footer: the whole project, whatever the filter shows. */}
      <Card className="bg-card p-4 shadow-sm sm:p-5">
        <h3 className="sr-only">Project totals</h3>
        <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-5">
          <div>
            <dt className="text-muted-foreground">Total quoted (A)</dt>
            <dd className="mt-1 text-lg">
              <Money cents={totals.tenderCents} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tradie quoted (B)</dt>
            <dd className="mt-1 text-lg">
              <Money cents={totals.quotedCents} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Total invoiced (C)</dt>
            <dd className="mt-1 text-lg">
              <Money cents={totals.invoicedCents} />
            </dd>
            {totals.unallocatedCents > 0 ? (
              <dd className="text-xs text-muted-foreground">
                incl. {formatCents(totals.unallocatedCents)} not yet allocated
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-muted-foreground">Profit/Loss to date</dt>
            <dd className="mt-1 text-right text-base lg:text-left">
              <ProfitLoss figures={totals} showForecast={false} />
            </dd>
            <dd className="text-xs text-muted-foreground">
              On the activities invoiced so far
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Forecast at completion</dt>
            <dd className="mt-1 text-lg">
              <span
                className={
                  totals.forecastProfitCents < 0
                    ? "font-mono tabular-nums text-destructive-ink"
                    : "font-mono tabular-nums text-foreground"
                }
              >
                {formatCents(totals.forecastProfitCents)}
              </span>
              {totals.forecastPercent !== null ? (
                <span className="ml-1 font-mono text-sm tabular-nums text-muted-foreground">
                  {totals.forecastPercent.toFixed(1)}%
                </span>
              ) : null}
            </dd>
            <dd className="text-xs text-muted-foreground">
              A less each booking&apos;s quote or invoices, whichever is more
            </dd>
          </div>
        </dl>
      </Card>

      <RecordInvoiceDialog
        open={recordFor !== undefined}
        onOpenChange={(open) => {
          if (!open) setRecordFor(undefined);
        }}
        projectId={project.id}
        bookings={options}
        initialScheduleId={recordFor ?? null}
        onRecorded={(result) => {
          applyResult(result);
          toast.success("Invoice recorded.");
        }}
      />
      <RecheckInvoiceDialog
        projectId={project.id}
        scheduleId={recheckFor}
        onOpenChange={(open) => {
          if (!open) setRecheckFor(null);
        }}
      />
      <VoidInvoiceDialog
        invoice={voiding}
        projectId={project.id}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        onVoided={(result) => {
          applyResult(result);
          toast.success("Invoice voided.");
        }}
      />
    </div>
  );
}
