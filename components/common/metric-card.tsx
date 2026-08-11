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
}: MetricCardProps) {
  const displayValue = isCurrency
    ? (() => {
        const numericValue = typeof value === "number" ? value : Number(value);
        return Number.isFinite(numericValue)
          ? compactCurrency.format(numericValue)
          : "—";
      })()
    : value;

  const toneClass = tone ? METRIC_TONES[tone] : (iconTone ?? METRIC_TONES.primary);

  return (
    <Card className="overflow-hidden rounded-lg border-border/70 bg-white/95 shadow-sm">
      <CardContent className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
        <div
          className={cn(
            "grid size-9 place-items-center rounded-lg text-white",
            toneClass,
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-heading text-2xl font-semibold leading-none tracking-tight text-foreground">
            {displayValue}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{title}</p>
        </div>
        {trendDelta !== undefined && trendDelta !== 0 && (
          <TrendBadge value={trendDelta} isInverse={isInverse} />
        )}
      </CardContent>
    </Card>
  );
}
