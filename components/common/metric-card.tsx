"use client";
import { KPI_CELL_CLASS, KPI_LABEL_CLASS, kpiValueClass } from "./kpi-band";
import { TrendBadge } from "./trend-badge";
import { compactCurrency } from "@/utils/formatters";

export interface DataPoint {
  total: number;
  trendDelta: number;
}

// Tinted tiles with ink glyphs, not solid fills, for the bespoke project stat
// and payment cards. The KPI band itself carries no icons. The base status
// fills are not used for glyphs: `--warning` only reaches 2.05:1 on white.
export const METRIC_TONES = {
  primary: "bg-royal-gold-light text-royal-gold-ink-text",
  success: "bg-success-light text-success-ink",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
  info: "bg-info-light text-info-ink",
  accent: "bg-royal-gold-light text-royal-gold-ink-text",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type MetricTone = keyof typeof METRIC_TONES;

export interface KPIListItem {
  title: string;
  dataPoint: DataPoint;
  isCurrency?: boolean;
  isInverse?: boolean; // Indicates if the trend delta should be treated as inverse (e.g., a negative trend is good)
}

interface MetricCardProps {
  title: string;
  value: string | number;
  trendDelta?: number;
  isCurrency?: boolean;
  isInverse?: boolean; // Indicates if the trend delta should be treated as inverse (e.g., a negative trend is good)
  /**
   * Optional small line under the figure. Use it where the headline number is
   * meaningless without its sample size — a 60% win rate could be 3-of-5 or
   * 60-of-100, and over a 90-day window with few closes that difference is the
   * whole story.
   */
  caption?: string;
}

/** One figure in a KpiBand. Render it inside `<KpiBand>`, never on its own. */
export function MetricCard({
  title,
  value,
  trendDelta,
  isCurrency,
  isInverse,
  caption,
}: MetricCardProps) {
  const displayValue = isCurrency
    ? (() => {
        const numericValue = typeof value === "number" ? value : Number(value);
        return Number.isFinite(numericValue)
          ? compactCurrency.format(numericValue)
          : "—";
      })()
    : value;

  return (
    <div className={KPI_CELL_CLASS}>
      <p className={KPI_LABEL_CLASS}>{title}</p>
      <p className={kpiValueClass(String(displayValue).includes("$"))}>
        {displayValue}
      </p>
      {trendDelta || caption ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {trendDelta ? (
            <TrendBadge value={trendDelta} isInverse={isInverse} />
          ) : null}
          {caption ? (
            <span className="min-w-0 break-words font-mono text-[11px] tabular-nums sm:truncate">
              {caption}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
