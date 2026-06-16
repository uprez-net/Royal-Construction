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

export interface KPIListItem {
  title: string;
  dataPoint: DataPoint;
  Icon: LucideIcon;
  iconTone: string;
  isCurrency?: boolean;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  trendDelta?: number;
  iconTone: string;
  Icon: LucideIcon;
  isCurrency?: boolean;
}

export function MetricCard({
  title,
  value,
  trendDelta,
  iconTone,
  Icon,
  isCurrency,
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
    <Card className="overflow-hidden rounded-lg border-border/70 bg-white/95 shadow-sm">
      <CardContent className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
        <div
          className={cn(
            "grid size-9 place-items-center rounded-lg text-white",
            iconTone,
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-heading text-2xl font-semibold leading-none tracking-tight text-foreground">
            {displayValue}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {title}
          </p>
        </div>
        {trendDelta !== undefined && trendDelta !== 0 && (
          <TrendBadge value={trendDelta} />
        )}
      </CardContent>
    </Card>
  );
}
