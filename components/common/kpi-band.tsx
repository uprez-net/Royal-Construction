import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A row of figures on one white surface with hairlines between them, not a row
 * of tiles (docs/design-demo .kpis). No "use client": loading.tsx skeletons
 * render it on the server.
 *
 * Each cell draws a hairline on its own left and top edge. The grid sits 1px up
 * and left inside a clipping frame, so the lines on the outer edge fall outside
 * it however the row wraps, and an odd count leaves no grey gap.
 */
export function KpiBand({
  className,
  children,
}: {
  /** Column counts, e.g. "grid-cols-2 xl:grid-cols-4", or the phone strip. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/4">
      <div
        className={cn(
          "-mt-px -ml-px grid *:shadow-[inset_1px_1px_0_var(--color-border)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The band's phone layout: figures scroll sideways, two and a bit in view,
 * instead of stacking rows deep and pushing the list below the fold. From sm up
 * it is a grid, so add the `sm:grid-cols-*` and wider counts the row needs.
 */
export const MOBILE_METRIC_STRIP_CLASS =
  "flex snap-x snap-mandatory overflow-x-auto no-scrollbar *:w-[44%] *:min-w-36 *:shrink-0 *:snap-start sm:grid sm:overflow-visible sm:*:w-auto sm:*:min-w-0";

/** One figure in a KpiBand: label, value, then an optional foot line. */
export const KPI_CELL_CLASS = "min-w-0 px-4 py-3.5 sm:px-5 sm:py-4";
export const KPI_LABEL_CLASS =
  "text-[11px] leading-[1.4] font-semibold tracking-[0.06em] text-muted-foreground uppercase sm:truncate";

/**
 * Counts in the display face; money in mono (DESIGN.md, Mono Precision Rule).
 * Line height rides on the size (text-x/[1.15]): cn() drops a separate
 * leading-* that comes before a font-size class.
 */
export function kpiValueClass(isMoney: boolean) {
  return cn(
    "mt-1.5 text-foreground",
    isMoney
      ? "font-mono text-[1.375rem]/[1.15] font-medium tracking-[-0.01em] tabular-nums"
      : "font-heading text-[1.75rem]/[1.15] font-semibold tracking-[-0.02em]",
  );
}
