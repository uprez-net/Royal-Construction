"use client";

import type { ReactNode } from "react";

interface DataTableProps {
  headers: ReactNode[];
  rows: ReactNode[][];
  onRowClick?: (rowIndex: number) => void;
  emptyState?: ReactNode;
}

export function DataTable({
  headers,
  rows,
  onRowClick,
  emptyState,
}: DataTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/70 text-left text-xs uppercase tracking-[0.15em] text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th key={index} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-t border-border/70 transition-colors hover:bg-muted/40"
                onClick={
                  onRowClick
                    ? () => onRowClick(rowIndex)
                    : undefined
                }
              >
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3">
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
  );
}