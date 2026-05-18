"use client";

import React from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { setProjectFilter } from "@/lib/store/slices/uiSlice";
import type { ProjectKPIs } from "@/types/project";

interface ProjectFiltersProps {
  kpis: ProjectKPIs;
  activeFilter: string | null;
  onFilterChange: () => void;
}

export function ProjectFilters({ kpis, activeFilter, onFilterChange }: ProjectFiltersProps) {
  const dispatch = useAppDispatch();

  const filters = [
    { label: "All", value: null, count: kpis.totalActive },
    { label: "On Track", value: "ON_TRACK", count: kpis.onTrack },
    { label: "Needs Attention", value: "NEEDS_ATTENTION", count: kpis.needsAttention },
    { label: "Delayed", value: "DELAYED", count: kpis.delayed },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => (
        <button
          key={filter.label}
          onClick={() => {
            dispatch(setProjectFilter({ status: filter.value }));
            onFilterChange();
          }}
          className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            activeFilter === filter.value
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-border bg-white text-foreground hover:border-teal-600 hover:text-teal-600"
          }`}
        >
          {filter.label} ({filter.count})
        </button>
      ))}
    </div>
  );
}
