import type { ComponentProps, ReactNode } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

// The Leads list's toolbar, chips and table card (components/leads/leads.tsx,
// components/leads/views/table-view.tsx and the .search-box, .filter-chip,
// .table-card and .table-header rules in app/globals.css), as shared parts so
// every list in the app has the same controls. Leads keeps its own CSS; these
// copy its values. No hooks and no "use client": loading.tsx skeletons render
// these on the server.
//
// Placement, as on Leads:
//   page-level list:  PageHeader, KpiBand, <ListToolbar> on the page, then one
//                     <TableCard> (chips in its header, if any) with a flush table.
//   section-level list (a detail tab, a dashboard widget): one <TableCard>
//                     whose header holds the title and the same controls.
// Never put a card around a TableCard.

/**
 * The row on the page above a list: view tabs (or nothing) on the left, the
 * controls on the right, a hairline under it. Below sm the controls wrap
 * under the tabs.
 */
export function ListToolbar({
  start,
  children,
  className,
}: {
  /** View tabs, or a count. Optional. */
  start?: ReactNode;
  /** Sort, filter selects, ToolbarSearch, Export. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-2 border-b border-border/70 pb-3",
        className,
      )}
    >
      {start}
      {children ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The toolbar search field (.search-box): 44px, cream, a search glyph inside
 * the left edge. Below sm it takes the whole row and goes first. Pass `hint`
 * for a live message drawn inside the right edge (e.g. "Type 2+ characters").
 */
export function ToolbarSearch({
  className,
  hint,
  hintId,
  ...input
}: Omit<ComponentProps<"input">, "type"> & {
  "aria-label": string;
  hint?: ReactNode;
  hintId?: string;
}) {
  return (
    <div
      className={cn(
        "relative order-first w-full min-w-0 sm:order-none sm:w-55 sm:max-w-60 sm:min-w-45",
        className,
      )}
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        aria-describedby={hint !== undefined ? hintId : undefined}
        {...input}
        className="min-h-11 w-full rounded-lg border border-border bg-background py-1.75 pr-3 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_15%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {hint !== undefined ? (
        <p
          id={hintId}
          role="status"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A filter <SelectTrigger> in the toolbar: the Leads "Created" select. */
export const TOOLBAR_SELECT_TRIGGER_CLASS =
  "data-[size=default]:h-11 flex-1 rounded-lg border-input bg-card text-sm font-medium text-foreground shadow-none hover:bg-muted sm:flex-none";

/** A toolbar button (Export, Add): outline, 44px, as Leads' Export. */
export const TOOLBAR_BUTTON_CLASS = "h-11 shrink-0";

/**
 * Leads' view tabs (Table, Tasks, Analytics) for hand-rolled tab buttons:
 * label in muted ink, the active one semibold with a gold bar along its foot.
 * Render the bar with VIEW_TAB_BAR_CLASS inside the active button.
 */
export function viewTabClass(active: boolean) {
  return cn(
    "group relative inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium transition-colors duration-200 sm:text-[12.5px]",
    active
      ? "font-semibold text-foreground"
      : "text-muted-foreground hover:text-foreground",
  );
}
export const VIEW_TAB_BAR_CLASS =
  "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-royal-gold";

/**
 * The same tabs on Radix <Tabs>: pass these to TabsList (with variant="line")
 * and each TabsTrigger. They move the gold bar to the foot and match the size.
 */
export const VIEW_TABS_LIST_CLASS =
  "h-auto flex-wrap gap-1.5 p-0 group-data-horizontal/tabs:h-auto";
export const VIEW_TABS_TRIGGER_CLASS =
  "min-h-11 flex-none px-3 text-sm font-medium sm:text-[12.5px] hover:text-foreground data-active:font-semibold data-active:text-foreground group-data-horizontal/tabs:after:inset-x-2 group-data-horizontal/tabs:after:bottom-0 after:rounded-full";

/** A row of quick filter chips (.filter-chips): scrolls sideways, no bar. */
export function FilterChips({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** One quick filter (.filter-chip). A toggle: it sets aria-pressed. */
export function FilterChip({
  active,
  className,
  ...props
}: Omit<ComponentProps<"button">, "type" | "aria-pressed"> & {
  active: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center gap-1 rounded-lg px-3 py-1.25 text-[12.5px] font-semibold transition-colors duration-200 md:min-h-0",
        active
          ? "bg-royal-gold-light text-royal-gold-ink-text"
          : "text-foreground hover:bg-royal-gold/10",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The one card a list sits in (.table-card): a flat white surface, an optional
 * header strip (.table-header: chips, or a section title and its controls),
 * then the table edge to edge. Pass the table as children, with `flush` on a
 * DataTable. The card clips its corners; the table's own wrapper scrolls.
 */
export function TableCard({
  header,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "children"> & {
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4",
        className,
      )}
      {...props}
    >
      {header ? (
        <div className="border-b border-border px-4 py-4 sm:px-5">{header}</div>
      ) : null}
      {children}
    </section>
  );
}
