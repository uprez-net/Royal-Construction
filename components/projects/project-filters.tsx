"use client";

import React from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { setProjectFilter } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs } from "@/types/project";
import { cn } from "@/lib/utils";

interface ProjectFiltersProps {
  kpis: ProjectKPIs;
  activeFilter: string | null;
  onFilterChange: () => void;
}

export function ProjectFilters({
  kpis,
  activeFilter,
  onFilterChange,
}: ProjectFiltersProps) {
  const dispatch = useAppDispatch();

  const filters: { label: string; value: string | null; count: number }[] = [
    { label: "All", value: null, count: kpis.totalActive },
    { label: "On track", value: "ON_TRACK", count: kpis.onTrack },
    {
      label: "Needs attention",
      value: "NEEDS_ATTENTION",
      count: kpis.needsAttention,
    },
    { label: "Delayed", value: "DELAYED", count: kpis.delayed },
  ];

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Filter projects by status"
    >
      {filters.map((filter) => {
        const isActive = activeFilter === filter.value;

        return (
          <button
            key={filter.label}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              dispatch(setProjectFilter({ status: filter.value }));
              onFilterChange();
            }}
            className={cn(
              "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted/40",
            )}
          >
            {filter.label} ({filter.count})
          </button>
        );
      })}
    </div>
  );
}
