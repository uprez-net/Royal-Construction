"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Grid3x3, List } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  setProjectSearchQuery,
  setProjectSort,
  setProjectView,
} from "@/lib/store/slices/uiSlice";

type SortOption = "name" | "progress" | "budget" | "startDate" | "spent";

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Name A-Z", value: "name" },
  { label: "Progress (High-Low)", value: "progress" },
  { label: "Budget (High-Low)", value: "budget" },
  { label: "Start Date (Newest)", value: "startDate" },
  { label: "Spent (High-Low)", value: "spent" },
];

export function ProjectToolbar() {
  const dispatch = useAppDispatch();
  const searchQuery = useAppSelector(
    (state) => state.ui.projectFilters.searchQuery
  );
  const sortBy = useAppSelector(
    (state) => state.ui.projectFilters.sortBy
  );
  const view = useAppSelector((state) => state.ui.projectFilters.view);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Close sort menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(event.target as Node)
      ) {
        setSortMenuOpen(false);
      }
    };

    if (sortMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [sortMenuOpen]);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 gap-3">
        {/* Search Box */}
        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects, clients..."
            value={searchQuery}
            onChange={(e) => dispatch(setProjectSearchQuery(e.target.value))}
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder-muted-foreground focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-opacity-20"
          />
        </div>

        {/* Sort Dropdown */}
        <div className="relative" ref={sortMenuRef}>
          <button
            onClick={() => setSortMenuOpen(!sortMenuOpen)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-teal-600 hover:text-teal-600"
          >
            Sort
          </button>
          {sortMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-white shadow-lg z-20 animate-in fade-in slide-in-from-top-1 duration-150">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    dispatch(setProjectSort({ sortBy: option.value }));
                    setSortMenuOpen(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted ${
                    sortBy === option.value
                      ? "bg-teal-50 font-medium text-teal-600"
                      : "text-foreground"
                  }`}
                >
                  {sortBy === option.value && "✓ "}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* View Toggle & Export */}
      <div className="flex gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
          <button
            onClick={() => dispatch(setProjectView("grid"))}
            title="Grid View"
            className={`rounded p-2 transition-colors ${
              view === "grid"
                ? "bg-teal-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => dispatch(setProjectView("list"))}
            title="List View"
            className={`rounded p-2 transition-colors ${
              view === "list"
                ? "bg-teal-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
