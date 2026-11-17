"use client";

import { cn } from "@/lib/utils";
import { KPI_CELL_CLASS, KPI_LABEL_CLASS, kpiValueClass } from "./kpi-band";

/**
 * One figure in the Leads KpiBand. With `onClick` it is a filter toggle: the
 * active one takes a light-gold fill and a gold bar along its foot.
 */
export function LeadMetricCard({
  label,
  value,
  note,
  onClick,
  active = false,
  noteWraps = false,
  toggle = true,
}: {
  label: string;
  value: string;
  note: string;
  onClick?: () => void;
  active?: boolean;
  /** Let a long note run onto a second line instead of cutting it off. */
  noteWraps?: boolean;
  /** False for a figure that opens something rather than filtering. */
  toggle?: boolean;
}) {
  const content = (
    <>
      <p className={KPI_LABEL_CLASS}>{label}</p>
      {/* A long figure ($1,049,844,988) keeps its digits together from sm up.
          On a phone, where the cell is under 170px, it may break instead of
          running out of the cell. */}
      <p
        className={cn(
          kpiValueClass(value.includes("$")),
          "max-sm:[overflow-wrap:anywhere] sm:whitespace-nowrap",
          value.length > 9 && "text-xl/[1.15]",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-1.5 break-words text-xs text-muted-foreground",
          !noteWraps && "sm:truncate",
        )}
      >
        {note}
      </p>
    </>
  );

  const cell = cn(
    KPI_CELL_CLASS,
    "relative text-left transition-colors duration-150",
    active
      && "bg-royal-gold-light after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-royal-gold-ink",
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          cell,
          "cursor-pointer select-none focus-visible:outline-2 focus-visible:-outline-offset-[3px] focus-visible:outline-ring",
          !active && "hover:bg-muted",
        )}
        onClick={onClick}
        aria-pressed={toggle ? active : undefined}
        aria-label={`${label}: ${value}. ${note}`}
      >
        {content}
      </button>
    );
  }

  return <div className={cell}>{content}</div>;
}
