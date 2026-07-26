"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ColumnAlign = "start" | "end";

interface DataTableProps {
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
}: DataTableProps) {
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
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-muted/70 text-xs uppercase tracking-wider text-muted-foreground">
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
                  onRowClick &&
                    "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
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
                      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) =>
                        handleRowKeyDown(event, rowIndex),
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
              <td colSpan={headers.length} className="px-4 py-16 text-center">
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
  );
}
