"use client";

import React from "react";
import { DRAFTING_FILTER, type ProjectKPIs } from "@/types/project";
import { cn } from "@/lib/utils";
import type { ProjectStatusFilter } from "./projects-list-url";
import { MobileFilterSelect } from "@/components/common/mobile-filter-select";

interface ProjectFiltersProps {
  kpis: ProjectKPIs;
  activeFilter: ProjectStatusFilter;
  onFilterChange: (status: ProjectStatusFilter) => void;
}

export function ProjectFilters({
  kpis,
  activeFilter,
  onFilterChange,
}: ProjectFiltersProps) {
  const filters: {
    label: string;
    value: ProjectStatusFilter;
    count: number;
  }[] = [
    // Every project that is not completed (issue #450); a finished build is
    // on its own chip.
    { label: "All", value: null, count: kpis.totalActive },
    // Before "Active", because it is before it: a job is drafting until
    // somebody starts an activity on it, whatever its compliance file is
    // doing. See DRAFTING_FILTER (issue #452).
    { label: "Drafting", value: DRAFTING_FILTER, count: kpis.drafting },
    { label: "Active", value: "ACTIVE", count: kpis.active },
    { label: "On track", value: "ON_TRACK", count: kpis.onTrack },
    {
      label: "Needs attention",
      value: "NEEDS_ATTENTION",
      count: kpis.needsAttention,
    },
    { label: "Delayed", value: "DELAYED", count: kpis.delayed },
    { label: "Completed", value: "COMPLETED", count: kpis.completed },
  ];

  return (
    <>
      <MobileFilterSelect
        label="Project status"
        value={activeFilter ?? "all"}
        options={filters.map((filter) => ({
          value: filter.value ?? "all",
          label: filter.label,
          count: filter.count,
        }))}
        onChange={(value) =>
          onFilterChange(
            value === "all" ? null : (value as ProjectStatusFilter),
          )
        }
      />
      <div
        className="hidden flex-wrap gap-2 md:flex"
        role="group"
        aria-label="Filter projects by status"
      >
        {filters.map((filter) => {
          const isActive = activeFilter === filter.value;
          const isDrafting = filter.value === DRAFTING_FILTER;

          return (
            <button
              key={filter.label}
              type="button"
              aria-pressed={isActive}
              onClick={() => onFilterChange(filter.value)}
              className={cn(
                "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : isDrafting
                    ? "border-(--stage-3) bg-(--stage-2) text-foreground hover:bg-(--stage-3)"
                    : "border-border bg-card text-foreground hover:bg-muted/40",
              )}
            >
              {filter.label} ({filter.count})
            </button>
          );
        })}
      </div>
    </>
  );
}
