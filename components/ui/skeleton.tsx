import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TABLE_SURFACE_CLASS } from "./table-styles";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "min-w-0 max-w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

function PageSkeleton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  return (
    <div
      data-slot="page-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={className}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * One figure in a KpiBand, as MetricCard lays it out. `foot` stands in for the
 * trend badge or note line under the figure, so the row does not grow on load.
 */
function MetricCardSkeleton({ foot = false }: { foot?: boolean }) {
  return (
    <div className="min-w-0 space-y-2.5 px-4 py-3.5 sm:px-5 sm:py-4">
      <Skeleton className="h-3 w-24 max-w-full" />
      <Skeleton className="h-7 w-16" />
      {foot ? <Skeleton className="h-4 w-28 max-w-full" /> : null}
    </div>
  );
}

function skeletonTableRows(columnCount: number, rowCount = 5): ReactNode[][] {
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, col) => (
      <Skeleton key={`${row}-${col}`} className="h-4 w-full max-w-28" />
    )),
  );
}

/** Matches labelled list cards on phones and the comparison table on desktop. */
function DataTableSkeleton({
  columnCount,
  rowCount = 5,
  mobileLayout = "cards",
  mobileColumns = 2,
  flush = false,
}: {
  columnCount: number;
  rowCount?: number;
  mobileLayout?: "cards" | "scroll";
  mobileColumns?: 1 | 2;
  /** Mirrors DataTable's `flush`: no surface of its own, inside a card. */
  flush?: boolean;
}) {
  return (
    <>
      {mobileLayout === "cards" ? (
        <div className="space-y-3 md:hidden">
          {Array.from({ length: rowCount }, (_, row) => (
            <div
              key={row}
              className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/4"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="size-6 shrink-0 rounded-full" />
              </div>
              <div
                className={cn(
                  "mt-3 grid gap-x-4 gap-y-3",
                  mobileColumns === 2 && "grid-cols-2",
                )}
              >
                {Array.from({ length: columnCount - 1 }, (_, col) => (
                  <div key={col} className="min-w-0 space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          flush ? "min-w-0" : TABLE_SURFACE_CLASS,
          "overflow-x-auto",
          mobileLayout === "cards" && "hidden md:block",
        )}
      >
        <div
          className="min-w-160"
          style={{ minWidth: Math.max(480, columnCount * 88) }}
        >
          <div
            className="grid gap-4 bg-muted px-4 py-3"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: columnCount }, (_, col) => (
              <Skeleton key={col} className="h-3 w-20" />
            ))}
          </div>
          {Array.from({ length: rowCount }, (_, row) => (
            <div
              key={row}
              className="grid gap-4 border-t border-border px-4 py-3 first:border-t-0"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columnCount }, (_, col) => (
                <Skeleton key={col} className="h-4 w-28" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export {
  Skeleton,
  PageSkeleton,
  MetricCardSkeleton,
  DataTableSkeleton,
  skeletonTableRows,
};
