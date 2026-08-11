import { useId, useMemo, useState } from "react";
import { History, Search } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/common/data-table";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dataTimeFormat, toLabel } from "@/utils/formatters";
import type { ProjectDetail } from "@/types/project";

interface ProjectHistoryTabsProps {
  project: ProjectDetail;
}

const ALL_TYPES = "__all__";

export function ProjectHistoryTabs({ project }: ProjectHistoryTabsProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const searchId = useId();
  const typeId = useId();

  // `.sort()` mutates in place; sorting `project.activityLogs` directly
  // reordered the store's own array on every render.
  const history = useMemo(
    () =>
      [...project.activityLogs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [project.activityLogs],
  );

  // `ActivityLog.type` is a free-form string written by several call sites
  // ("projectCreated", "site-update", …). The previous hardcoded option list
  // ("lead", "quote", "payment", …) matched none of the values actually stored,
  // so a wired filter over it would always have returned nothing. Deriving the
  // options from the rows keeps the filter honest whatever gets logged.
  const typeOptions = useMemo(
    () => Array.from(new Set(history.map((entry) => entry.type))).sort(),
    [history],
  );

  const trimmedQuery = query.trim().toLowerCase();
  const isFiltered = trimmedQuery.length > 0 || typeFilter !== ALL_TYPES;

  const filteredHistory = useMemo(
    () =>
      history.filter((entry) => {
        if (typeFilter !== ALL_TYPES && entry.type !== typeFilter) {
          return false;
        }

        if (!trimmedQuery) {
          return true;
        }

        return [entry.message, toLabel(entry.type), entry.author?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(trimmedQuery);
      }),
    [history, trimmedQuery, typeFilter],
  );

  const clearFilters = () => {
    setQuery("");
    setTypeFilter(ALL_TYPES);
  };

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Project history
          </CardTitle>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <label
                htmlFor={typeId}
                className="block text-xs font-medium text-muted-foreground"
              >
                Activity type
              </label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger id={typeId} className="w-48">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>All types</SelectItem>
                  {typeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {toLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={searchId}
                className="block text-xs font-medium text-muted-foreground"
              >
                Search history
              </label>
              <div className="relative w-full sm:w-56">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id={searchId}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Description or author"
                  className="h-9 rounded-lg bg-background pl-8 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isFiltered
            ? `${filteredHistory.length} of ${history.length} entries shown`
            : `${history.length} ${history.length === 1 ? "entry" : "entries"}`}
        </p>
      </CardHeader>

      <CardContent className="pt-5">
        <DataTable
          caption="Recorded activity on this project, newest first."
          headers={["#", "Type", "Date", "Description", "Author"]}
          rows={filteredHistory.map((entry, index) => [
            <span
              key={`${entry.id}-number`}
              className="font-mono text-xs tabular-nums text-muted-foreground"
            >
              {index + 1}
            </span>,

            <StatusPill key={`${entry.id}-type`} tone="neutral">
              {toLabel(entry.type)}
            </StatusPill>,

            <span
              key={`${entry.id}-date`}
              className="font-mono text-xs tabular-nums"
            >
              {dataTimeFormat.format(new Date(entry.createdAt))}
            </span>,

            <span key={`${entry.id}-description`} className="text-sm">
              {entry.message}
            </span>,

            <span key={`${entry.id}-author`} className="text-sm">
              {entry.author?.name ?? "System"}
            </span>,
          ])}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-3">
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
                    ? "Try a different activity type or search term."
                    : "Milestone changes, uploads and schedule updates appear here."}
                </p>
              </div>

              {isFiltered ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}
