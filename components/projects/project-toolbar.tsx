"use client";

import React from "react";
import type { ReactNode } from "react";
import { Grid3x3, List } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setProjectView } from "@/lib/store/slices/uiSlice";
import { ListSortMenu } from "@/components/common/list-sort-menu";
import { ListToolbar, ToolbarSearch } from "@/components/common/list-toolbar";
import { cn } from "@/lib/utils";
import { PROJECT_SORT_OPTIONS, type ProjectSort } from "./projects-list-url";

interface ProjectToolbarProps {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  sort: ProjectSort;
  onSortChange: (sort: ProjectSort) => void;
  /** Export and New project, at the end of the row. */
  children?: ReactNode;
}

/** Compose project search, sorting and layout controls using the current list state. */
export function ProjectToolbar({
  searchTerm,
  onSearchTermChange,
  sort,
  onSortChange,
  children,
}: ProjectToolbarProps) {
  const dispatch = useAppDispatch();
  const view = useAppSelector((state) => state.ui.projectFilters.view);

  /** One half of the grid/table toggle, sized to the toolbar's 44px controls. */
  const viewToggleClass = (isActive: boolean) =>
    cn(
      "inline-flex h-11 w-11 items-center justify-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      isActive
        ? "bg-royal-gold-light text-royal-gold-ink-text"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <ListToolbar>
      <ListSortMenu
        label="projects"
        value={sort}
        options={PROJECT_SORT_OPTIONS}
        onChange={onSortChange}
      />
      <ToolbarSearch
        id="project-search"
        aria-label="Search projects"
        placeholder="Project or client name"
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
      />
      <div
        className="inline-flex h-11 shrink-0 overflow-hidden rounded-lg border border-input bg-card"
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
      {children}
    </ListToolbar>
  );
}
