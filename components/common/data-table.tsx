"use client";

import {
  Fragment,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton, PageSkeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";

export type ColumnAlign = "start" | "end";

interface DataTableProps {
  /** Lists can show labelled cards on phones; comparison tables keep scrolling. */
  mobileLayout?: "cards" | "scroll";
  mobileColumns?: 1 | 2;
  mobileTitleColumn?: number;
  /** Columns of running text that take a card's full width in two columns. */
  mobileWideColumns?: number[];
  /**
   * Where a card puts its actions column. "header" suits a single compact
   * control such as an overflow menu, which otherwise gets a row to itself.
   */
  mobileActionsPlacement?: "header" | "footer";
  loading?: boolean;
  loadingLabel?: string;
  headers: ReactNode[];
  rows: ReactNode[][];
  onRowClick?: (rowIndex: number) => void;
  emptyState?: ReactNode;
  /**
   * Per-column alignment, index-matched to `headers`. Use "end" for numeric
   * columns (money, counts, rates) so digits line up down the column.
   * Omitted columns default to "start".
   */
  align?: ColumnAlign[];
  /**
   * Accessible description of the table. Rendered as a visually hidden <caption>.
   */
  caption?: string;
  /**
   * Accessible name for each clickable row, e.g. (i) => `Open ${items[i].name}`.
   * Set this whenever `onRowClick` is set — without it the row is a control with
   * no name.
   */
  rowLabel?: (rowIndex: number) => string;
}

export function DataTable({
  headers,
  rows,
  onRowClick,
  emptyState,
  align,
  caption,
  rowLabel,
  mobileLayout = "scroll",
  mobileColumns = 2,
  mobileTitleColumn = 0,
  mobileWideColumns,
  mobileActionsPlacement = "footer",
  loading = false,
  loadingLabel = "Loading records",
}: DataTableProps) {
  // Mount one set of controls: duplicated editors can steal focus and repeat IDs.
  const isMobile = useMediaQuery("(max-width: 767px)");
  const showMobileCards = mobileLayout === "cards" && isMobile;
  if (loading)
    return (
      <PageSkeleton label={loadingLabel}>
        <DataTableSkeleton
          columnCount={headers.length}
          mobileLayout={mobileLayout}
          mobileColumns={mobileColumns}
        />
      </PageSkeleton>
    );
  const alignClass = (index: number) =>
    align?.[index] === "end" ? "text-right tabular-nums" : "text-left";

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    rowIndex: number,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Let controls inside the row (links, menus, buttons) handle their own keys.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onRowClick?.(rowIndex);
  };

  return (
    <>
      {showMobileCards && rows.length > 0 ? (
        <div
          role="list"
          className="flex flex-col gap-3 md:hidden"
          aria-label={caption}
        >
          {rows.map((row, rowIndex) => {
            // Unlabelled columns are not fields: one before the title (an
            // icon, a checkbox) leads the title, one after it is an actions
            // column and gets a row of its own. A "#" row number means nothing
            // once each row is its own card.
            const slot = (index: number) =>
              index === mobileTitleColumn
                ? "title"
                : isRowNumberHeader(headers[index])
                  ? "skip"
                  : !isActionsHeader(headers[index])
                    ? "field"
                    : index < mobileTitleColumn
                      ? "leading"
                      : "actions";
            const cellsIn = (wanted: string) =>
              row.flatMap((cell, index) =>
                cell !== null && slot(index) === wanted
                  ? [
                      <Fragment key={`mobile-${wanted}-${index}`}>
                        {cell}
                      </Fragment>,
                    ]
                  : [],
              );
            const leadingCells = cellsIn("leading");
            const actionCells = cellsIn("actions");
            return (
              <article
                role="listitem"
                key={`mobile-row-${rowIndex}`}
                className={cn(
                  "min-w-0 rounded-lg border border-border/70 bg-background",
                  onRowClick
                    && "cursor-pointer transition-colors active:bg-muted/40",
                )}
                // The whole card opens the record, as the whole row does on a
                // desktop; the chevron is the keyboard and screen-reader way
                // in. Controls inside the card keep their own taps.
                onClick={
                  onRowClick
                    ? (event) => {
                        if (isFromControl(event.target, event.currentTarget))
                          return;
                        onRowClick(rowIndex);
                      }
                    : undefined
                }
              >
                <div className="flex items-start gap-2 px-4 pt-3">
                  {leadingCells.length > 0 ? (
                    <div className="flex min-h-9 shrink-0 items-center gap-2">
                      {leadingCells}
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1 py-1.5 text-base font-semibold [overflow-wrap:anywhere]">
                    {row[mobileTitleColumn]}
                  </div>
                  {mobileActionsPlacement === "header"
                  && actionCells.length > 0 ? (
                    <div className="flex shrink-0 items-center">
                      {actionCells}
                    </div>
                  ) : null}
                  {onRowClick ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="-mr-2 shrink-0 text-muted-foreground"
                      aria-label={
                        rowLabel?.(rowIndex) ?? `Open row ${rowIndex + 1}`
                      }
                      onClick={() => onRowClick(rowIndex)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
                <dl
                  className={cn(
                    "grid gap-x-4 gap-y-3 px-4 pt-2 pb-4",
                    mobileColumns === 2 && "grid-cols-2",
                  )}
                >
                  {row.map((cell, index) =>
                    cell === null || slot(index) !== "field" ? null : (
                      <div
                        key={`mobile-cell-${index}`}
                        className={cn(
                          "min-w-0",
                          mobileWideColumns?.includes(index) && "col-span-full",
                        )}
                      >
                        <dt className="mb-1 text-xs text-muted-foreground">
                          {headers[index]}
                        </dt>
                        <dd className="text-sm [overflow-wrap:anywhere] [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
                          {cell}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
                {mobileActionsPlacement === "footer"
                && actionCells.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-2">
                    {actionCells}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {!showMobileCards || rows.length === 0 ? (
        <div
          className={cn(
            "min-w-0 overflow-x-auto rounded-lg border border-border/70 bg-background",
            mobileLayout === "cards" && rows.length > 0 && "hidden md:block",
          )}
        >
          <table className="w-full border-collapse text-sm">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead
              className={cn(
                "bg-muted/70 text-xs uppercase tracking-wider text-muted-foreground",
                rows.length === 0 && "hidden md:table-header-group",
              )}
            >
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={`header-${index}`}
                    scope="col"
                    className={cn("px-4 py-3 font-medium", alignClass(index))}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.length > 0 ? (
                rows.map((row, rowIndex) => (
                  <tr
                    key={`row-${rowIndex}`}
                    className={cn(
                      "border-t border-border/70 transition-colors",
                      onRowClick
                        && "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    )}
                    // A clickable row is an interactive control: without role, name,
                    // tab stop and Enter/Space, keyboard users cannot reach the
                    // navigation that mouse users get for free.
                    {...(onRowClick
                      ? {
                          role: "button" as const,
                          tabIndex: 0,
                          // Falls back to a positional name. `rowLabel` is optional,
                          // so without this a caller that forgets it ships a
                          // role="button" with aria-label={undefined} — an unnamed
                          // interactive control. A generic name is a poor label but
                          // a far better failure mode than none.
                          "aria-label":
                            rowLabel?.(rowIndex) ?? `Open row ${rowIndex + 1}`,
                          onClick: () => onRowClick(rowIndex),
                          onKeyDown: (
                            event: KeyboardEvent<HTMLTableRowElement>,
                          ) => handleRowKeyDown(event, rowIndex),
                        }
                      : {})}
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`cell-${rowIndex}-${cellIndex}`}
                        className={cn("px-4 py-3", alignClass(cellIndex))}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={headers.length}
                    className="px-4 py-16 text-center"
                  >
                    {emptyState ?? (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          No data available
                        </p>

                        <p className="text-xs text-muted-foreground">
                          There are currently no rows to display.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

/**
 * A column with no visible label: blank, or only "Actions" (often sr-only, so
 * the desktop header cell still has a name). Rendering it as a labelled field
 * on a card printed an empty or redundant label above the controls.
 */
function isActionsHeader(header: ReactNode) {
  const text = textOf(header).trim().toLowerCase();
  return text === "" || text === "actions";
}

function isRowNumberHeader(header: ReactNode) {
  return textOf(header).trim() === "#";
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

/**
 * True when a tap should not open the card's record: it landed on a control in
 * the card, or outside the card's DOM altogether — React bubbles events from a
 * portalled menu or dialog opened by a cell up through the card.
 */
function isFromControl(target: EventTarget, card: Element) {
  if (!(target instanceof Element) || !card.contains(target)) return true;
  const control = target.closest(
    "a, button, input, select, textarea, label, summary, [role='button'], [role='combobox'], [role='checkbox'], [role='switch'], [role='menuitem']",
  );
  return control !== null && control !== card && card.contains(control);
}
