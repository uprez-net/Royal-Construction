"use client";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendBadge } from "./trend-badge";
import type { LucideIcon } from "lucide-react";
import { compactCurrency } from "@/utils/formatters";

export interface DataPoint {
  total: number;
  trendDelta: number;
}

/**
 * Semantic icon tones. Prefer these over `iconTone` class strings — passing raw
 * palette classes (`bg-blue-600`, `bg-yellow-600`) is what produced four
 * different colour encodings of the same four statuses across the app.
 *
 * These map to the -ink tokens, not the base fills, because the glyph on top is
 * white: `--warning` only reaches 2.05:1 against white, so a white icon on it is
 * invisible. The -ink variants all clear 4.55:1.
 */
/**
 * A row of metric cards above a list. On a phone the cards scroll sideways,
 * two and a bit in view, instead of stacking rows deep and pushing the list
 * below the fold; from sm up the row is a grid, so add the `sm:grid-cols-*`
 * and wider column counts the row needs.
 */
export const MOBILE_METRIC_STRIP_CLASS =
  "-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1 no-scrollbar *:w-[44%] *:min-w-36 *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto sm:*:min-w-0";

export const METRIC_TONES = {
  primary: "bg-primary",
  success: "bg-success-ink",
  warning: "bg-warning-ink",
  danger: "bg-destructive-ink",
  info: "bg-info-ink",
  accent: "bg-royal-gold-ink",
  neutral: "bg-muted-foreground",
} as const;

export type MetricTone = keyof typeof METRIC_TONES;

export interface KPIListItem {
  title: string;
  dataPoint: DataPoint;
  Icon: LucideIcon;
  /** Prefer `tone`. Raw class string, kept for call sites not yet migrated. */
  iconTone?: string;
  tone?: MetricTone;
  isCurrency?: boolean;
  isInverse?: boolean; // Indicates if the trend delta should be treated as inverse (e.g., a negative trend is good)
}

interface MetricCardProps {
  title: string;
  value: string | number;
  trendDelta?: number;
  /** Semantic tone. Takes precedence over `iconTone`. */
  tone?: MetricTone;
  /** @deprecated Pass `tone` instead. */
  iconTone?: string;
  Icon: LucideIcon;
  isCurrency?: boolean;
  isInverse?: boolean; // Indicates if the trend delta should be treated as inverse (e.g., a negative trend is good)
  /**
   * Optional small line under the title. Use it where the headline number is
   * meaningless without its sample size — a 60% win rate could be 3-of-5 or
   * 60-of-100, and over a 90-day window with few closes that difference is the
   * whole story.
   */
  caption?: string;
}

export function MetricCard({
  title,
  value,
  trendDelta,
  tone,
  iconTone,
  Icon,
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

  const toneClass = tone
    ? METRIC_TONES[tone]
    : (iconTone ?? METRIC_TONES.primary);

  return (
    <Card className="overflow-hidden rounded-lg border-border/70 bg-white/95 py-0 shadow-sm sm:py-4">
      <CardContent className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3 sm:px-4">
        <div
          className={cn(
            "grid size-7 place-items-center rounded-lg text-white sm:size-9",
            toneClass,
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-heading text-2xl font-semibold leading-none tracking-tight text-foreground">
            {displayValue}
          </p>
          <p className="mt-1 text-xs text-muted-foreground sm:truncate">
            {title}
          </p>
          {caption ? (
            <p className="mt-0.5 break-words font-mono text-[10.5px] tabular-nums text-muted-foreground sm:truncate">
              {caption}
            </p>
          ) : null}
        </div>
        {trendDelta !== undefined && trendDelta !== 0 && (
          <div className="col-start-2 sm:col-start-auto">
            <TrendBadge value={trendDelta} isInverse={isInverse} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
