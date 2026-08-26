import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  )
}

function PageSkeleton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={className}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

function MetricCardSkeleton() {
  return (
    <div className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm">
      <Skeleton className="size-9 rounded-lg" />
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-3 w-28 max-w-full" />
      </div>
      <Skeleton className="h-5 w-12 rounded-md" />
    </div>
  )
}

function skeletonTableRows(
  columnCount: number,
  rowCount = 5,
): ReactNode[][] {
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, col) => (
      <Skeleton
        key={`${row}-${col}`}
        className="h-4 w-full max-w-28"
      />
    )),
  )
}

export { Skeleton, PageSkeleton, MetricCardSkeleton, skeletonTableRows }
