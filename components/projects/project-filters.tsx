"use client";

import React from "react";
import { PRE_CONSTRUCTION_FILTER, type ProjectKPIs } from "@/types/project";
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
    { label: "All", value: null, count: kpis.totalActive + kpis.completed },
    // Before "Active", because it is before it: a job is in the pipeline until
    // somebody starts a milestone on it. Three statuses under one chip — see
    // PRE_CONSTRUCTION_FILTER, which is what the server matches it against.
    {
      label: "Pre-construction",
      value: PRE_CONSTRUCTION_FILTER,
      count: kpis.preConstruction,
    },
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
          const isPreConstruction = filter.value === PRE_CONSTRUCTION_FILTER;

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
                  : isPreConstruction
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
