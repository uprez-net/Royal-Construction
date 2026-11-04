"use client";

import React from "react";
import { ArrowDownUp, Grid3x3, List, Search } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setProjectView } from "@/lib/store/slices/uiSlice";
import type { ProjectListSortBy } from "@/lib/domain/projects/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PROJECT_SORT_OPTIONS } from "./projects-list-url";

interface ProjectToolbarProps {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  sort: ProjectListSortBy;
  onSortChange: (sort: ProjectListSortBy) => void;
}

export function ProjectToolbar({
  searchTerm,
  onSearchTermChange,
  sort,
  onSortChange,
}: ProjectToolbarProps) {
  const dispatch = useAppDispatch();
  const view = useAppSelector((state) => state.ui.projectFilters.view);

  const activeSortLabel =
    PROJECT_SORT_OPTIONS.find((option) => option.value === sort)?.label
    ?? "Name A–Z";

  // 44px targets at the 0.9 zoom this app applies above 1024px; `size-11`
  // would render at ~40px, so the toggle keeps generous padding instead of an
  // icon-sized box.
  const viewToggleClass = (isActive: boolean) =>
    cn(
      "inline-flex size-11 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
    );

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 items-center gap-3">
        <div className="relative flex-1 md:max-w-xs">
          <Label htmlFor="project-search" className="sr-only">
            Search projects
          </Label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="project-search"
            type="search"
            placeholder="Project or client name"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            className="h-11 pl-9 pr-3"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2"
              aria-label={`Sort projects, currently ${activeSortLabel}`}
            >
              <ArrowDownUp className="size-4" aria-hidden="true" />
              Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sort}
              onValueChange={(value) => {
                const option = PROJECT_SORT_OPTIONS.find(
                  (candidate) => candidate.value === value,
                );
                if (option) onSortChange(option.value);
              }}
            >
              {PROJECT_SORT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className="flex gap-1 self-start rounded-lg border border-border bg-background p-1"
        role="group"
        aria-label="Project layout"
      >
        <button
          type="button"
          onClick={() => dispatch(setProjectView("grid"))}
          aria-label="Card view"
          aria-pressed={view === "grid"}
          className={viewToggleClass(view === "grid")}
        >
          <Grid3x3 className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => dispatch(setProjectView("list"))}
          aria-label="Table view"
          aria-pressed={view === "list"}
          className={viewToggleClass(view === "list")}
        >
          <List className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
