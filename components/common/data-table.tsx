"use client";

import type { KeyboardEvent, ReactNode } from "react";
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
          {rows.map((row, rowIndex) => (
            <article
              role="listitem"
              key={`mobile-row-${rowIndex}`}
              className="min-w-0 rounded-lg border border-border/70 bg-background p-4"
            >
              <div className="text-base font-semibold [overflow-wrap:anywhere]">
                {row[mobileTitleColumn]}
              </div>
              <dl
                className={cn(
                  "mt-3 grid gap-x-4 gap-y-3",
                  mobileColumns === 2 && "grid-cols-2",
                )}
              >
                {row.map((cell, index) =>
                  index === mobileTitleColumn ? null : (
                    <div key={`mobile-cell-${index}`} className="min-w-0">
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
              {onRowClick ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 w-full"
                  aria-label={
                    rowLabel?.(rowIndex) ?? `Open row ${rowIndex + 1}`
                  }
                  onClick={() => onRowClick(rowIndex)}
                >
                  View details
                </Button>
              ) : null}
            </article>
          ))}
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
