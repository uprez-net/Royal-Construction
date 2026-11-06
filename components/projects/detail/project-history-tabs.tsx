"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Camera,
  FileText,
  FilePen,
  Flag,
  HardHat,
  History,
  Mail,
  Receipt,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect } from "@/components/common/filter-select";
import {
  useDebouncedSearchParam,
  useSearchParamFilters,
} from "@/hooks/use-search-param-filters";
import {
  ACTIVITY_CATEGORY_LABEL,
  activityCategory,
  activityTitle,
  type ActivityCategory,
} from "@/lib/projects/activity-categories";
import {
  TIME_WINDOWS,
  TIME_WINDOW_LABEL,
  countValues,
  isTimeWindow,
  isWithinWindow,
} from "@/lib/files/file-filters";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/project";

interface ProjectHistoryTabsProps {
  project: ProjectDetail;
}

/** The tab's filters, as search parameters on the project URL. */
const PARAMS = [
  "histQ",
  "histCat",
  "histType",
  "histWhen",
  "histFrom",
  "histTo",
  "histMilestone",
  "histBy",
] as const;

/** Entries drawn per press of "Show more": long jobs log thousands. */
const PAGE_SIZE = 60;

const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = {
  compliance: ShieldCheck,
  documents: FileText,
  variations: FilePen,
  financials: Receipt,
  tradies: HardHat,
  milestones: Flag,
  site: Camera,
  email: Mail,
  project: Building2,
  other: Activity,
};

const dayHeading = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const entryTime = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", or the full day, as the reference timeline reads. */
function dayLabel(date: Date, now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return `Today · ${dayHeading.format(date)}`;
  if (diff === 1) return `Yesterday · ${dayHeading.format(date)}`;
  return dayHeading.format(date);
}

export function ProjectHistoryTabs({ project }: ProjectHistoryTabsProps) {
  const [filters, setFilters] = useSearchParamFilters(PARAMS);
  const [query, setQuery] = useDebouncedSearchParam(filters.histQ, (histQ) =>
    setFilters({ histQ }),
  );
  const [now] = useState(() => new Date());
  const [limit, setLimit] = useState(PAGE_SIZE);

  const milestoneNames = useMemo(
    () =>
      new Map(
        project.milestones.map((milestone) => [milestone.id, milestone.name]),
      ),
    [project.milestones],
  );

  // `.sort()` mutates in place; the store's own array must not be reordered.
  const history = useMemo(
    () =>
      [...project.activityLogs]
        .map((entry) => {
          const createdAt = new Date(entry.createdAt);
          return {
            ...entry,
            createdAt,
            category: activityCategory(entry.type),
            title: activityTitle(entry.type),
            authorName: entry.author?.name ?? "System",
            milestoneName: entry.milestoneId
              ? (milestoneNames.get(entry.milestoneId) ?? null)
              : null,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [milestoneNames, project.activityLogs],
  );

  // Options come from the rows, with counts, so no choice leads to nothing.
  const options = useMemo(
    () => ({
      categories: countValues(history.map((entry) => entry.category)).map(
        ({ value, count }) => ({
          value,
          label: ACTIVITY_CATEGORY_LABEL[value as ActivityCategory] ?? value,
          count,
        }),
      ),
      types: countValues(
        history
          .filter(
            (entry) => !filters.histCat || entry.category === filters.histCat,
          )
          .map((entry) => entry.type),
      ).map(({ value, count }) => ({
        value,
        label: activityTitle(value),
        count,
      })),
      milestones: countValues(
        history.flatMap((entry) =>
          entry.milestoneName ? [entry.milestoneName] : [],
        ),
      ).map(({ value, count }) => ({ value, label: value, count })),
      authors: countValues(history.map((entry) => entry.authorName)).map(
        ({ value, count }) => ({ value, label: value, count }),
      ),
    }),
    [filters.histCat, history],
  );

  const when = isTimeWindow(filters.histWhen) ? filters.histWhen : null;
  const committedQuery = filters.histQ.trim().toLowerCase();
  const activeFilterCount = [
    filters.histQ,
    filters.histCat,
    filters.histType,
    when,
    filters.histMilestone,
    filters.histBy,
  ].filter(Boolean).length;
  const isFiltered = activeFilterCount > 0;

  const filtered = useMemo(
    () =>
      history.filter((entry) => {
        if (filters.histCat && entry.category !== filters.histCat) return false;
        if (filters.histType && entry.type !== filters.histType) return false;
        if (
          filters.histMilestone
          && entry.milestoneName !== filters.histMilestone
        ) {
          return false;
        }
        if (filters.histBy && entry.authorName !== filters.histBy) return false;
        if (
          !isWithinWindow(entry.createdAt, when, now, {
            from: filters.histFrom,
            to: filters.histTo,
          })
        ) {
          return false;
        }
        if (!committedQuery) return true;
        return [
          entry.title,
          entry.message,
          entry.authorName,
          entry.milestoneName ?? "",
          ACTIVITY_CATEGORY_LABEL[entry.category],
        ]
          .join(" ")
          .toLowerCase()
          .includes(committedQuery);
      }),
    [committedQuery, filters, history, now, when],
  );

  const shown = filtered.slice(0, limit);
  const days = useMemo(() => {
    const groups: { key: string; label: string; entries: typeof shown }[] = [];
    for (const entry of shown) {
      const key = dayKey(entry.createdAt);
      const last = groups.at(-1);
      if (last?.key === key) last.entries.push(entry);
      else
        groups.push({
          key,
          label: dayLabel(entry.createdAt, now),
          entries: [entry],
        });
    }
    return groups;
  }, [now, shown]);

  const clearFilters = () => {
    setQuery("");
    setLimit(PAGE_SIZE);
    setFilters(
      Object.fromEntries(PARAMS.map((key) => [key, null])) as Record<
        (typeof PARAMS)[number],
        null
      >,
    );
  };

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="space-y-4 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle
              as="h2"
              className="text-base font-semibold text-foreground"
            >
              Activity timeline
            </CardTitle>
            <p
              className="text-sm text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {isFiltered
                ? `${filtered.length} of ${history.length} events match`
                : `${history.length} ${history.length === 1 ? "event" : "events"} · newest first`}
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search events, people or milestones"
              className="h-9 rounded-lg pl-9 text-sm"
              aria-label="Search history"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <FilterSelect
            label="When"
            allLabel="Any time"
            value={when ?? ""}
            onChange={(histWhen) => {
              setLimit(PAGE_SIZE);
              setFilters(
                histWhen === "custom"
                  ? { histWhen }
                  : { histWhen, histFrom: null, histTo: null },
              );
            }}
            options={TIME_WINDOWS.map((window) => ({
              value: window,
              label: TIME_WINDOW_LABEL[window],
            }))}
          />
          <FilterSelect
            label="Category"
            allLabel="All categories"
            value={filters.histCat}
            onChange={(histCat) => {
              setLimit(PAGE_SIZE);
              // A type from another category would leave nothing to show.
              setFilters({ histCat, histType: null });
            }}
            options={options.categories}
          />
          <FilterSelect
            label="Activity type"
            allLabel="All types"
            value={filters.histType}
            onChange={(histType) => {
              setLimit(PAGE_SIZE);
              setFilters({ histType });
            }}
            options={options.types}
          />
          <FilterSelect
            label="Milestone"
            allLabel="All milestones"
            value={filters.histMilestone}
            onChange={(histMilestone) => {
              setLimit(PAGE_SIZE);
              setFilters({ histMilestone });
            }}
            options={options.milestones}
            disabled={options.milestones.length === 0 && !filters.histMilestone}
          />
          <FilterSelect
            label="By"
            allLabel="Anyone"
            value={filters.histBy}
            onChange={(histBy) => {
              setLimit(PAGE_SIZE);
              setFilters({ histBy });
            }}
            options={options.authors}
          />
        </div>

        {when === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span className="block">From</span>
              <Input
                type="date"
                value={filters.histFrom}
                max={filters.histTo || undefined}
                onChange={(event) =>
                  setFilters({ histFrom: event.target.value })
                }
                className="h-9 w-40"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span className="block">To</span>
              <Input
                type="date"
                value={filters.histTo}
                min={filters.histFrom || undefined}
                onChange={(event) => setFilters({ histTo: event.target.value })}
                className="h-9 w-40"
              />
            </label>
          </div>
        ) : null}

        {options.categories.length > 1 || isFiltered ? (
          <div className="flex flex-wrap items-center gap-2">
            {options.categories.map(({ value, label, count }) => {
              const Icon = CATEGORY_ICON[value as ActivityCategory] ?? Activity;
              const active = filters.histCat === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setLimit(PAGE_SIZE);
                    setFilters({
                      histCat: active ? null : value,
                      histType: null,
                    });
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/70 bg-background text-foreground hover:border-primary/40 hover:text-primary",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </button>
              );
            })}
            {isFiltered ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={clearFilters}
              >
                <X data-icon="inline-start" aria-hidden="true" />
                Clear {activeFilterCount}{" "}
                {activeFilterCount === 1 ? "filter" : "filters"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="p-4 sm:p-6">
        {days.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <History
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {isFiltered
                  ? "No activity matches these filters"
                  : "No activity recorded yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isFiltered
                  ? "Try a wider time range, another category or a different search."
                  : "Milestone changes, uploads, bookings and compliance steps appear here."}
              </p>
            </div>
            {isFiltered ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
                  {day.label}
                </h3>
                <ol className="space-y-3">
                  {day.entries.map((entry, index) => {
                    const Icon = CATEGORY_ICON[entry.category];
                    const isLast = index === day.entries.length - 1;
                    return (
                      <li key={entry.id} className="relative flex gap-3">
                        <div className="relative flex w-8 shrink-0 justify-center">
                          <span className="z-10 flex size-8 items-center justify-center rounded-full border border-border/70 bg-muted text-primary">
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          {isLast ? null : (
                            <span
                              aria-hidden="true"
                              className="absolute top-8 -bottom-3 left-1/2 w-px -translate-x-1/2 bg-border"
                            />
                          )}
                        </div>
                        <article className="min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h4 className="min-w-0 text-sm font-semibold text-foreground">
                              {entry.title}
                            </h4>
                            <button
                              type="button"
                              onClick={() => {
                                setLimit(PAGE_SIZE);
                                setFilters({
                                  histCat: entry.category,
                                  histType: null,
                                });
                              }}
                              title={`Show only ${ACTIVITY_CATEGORY_LABEL[entry.category]}`}
                              className="shrink-0 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            >
                              {ACTIVITY_CATEGORY_LABEL[entry.category]}
                            </button>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {entry.authorName} ·{" "}
                            <time dateTime={entry.createdAt.toISOString()}>
                              {entryTime.format(entry.createdAt)}
                            </time>
                            {entry.milestoneName ? (
                              <> · {entry.milestoneName}</>
                            ) : null}
                          </p>
                          {entry.message ? (
                            <p className="mt-1.5 text-sm break-words text-foreground/90">
                              {entry.message}
                            </p>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {filtered.length > shown.length ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - shown.length)}{" "}
                  more of {filtered.length - shown.length}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
