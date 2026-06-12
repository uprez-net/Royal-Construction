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
  return (
    <Card className="border-border/70 bg-white/95">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div
            className={cn(
              "grid size-11 place-items-center rounded-xl text-white",
              iconTone,
            )}
          >
            <Icon className="size-5" />
          </div>
          {trendDelta !== undefined && trendDelta !== 0 && (
            <TrendBadge value={trendDelta} />
          )}
        </div>
        <p className="text-3xl font-bold">
          {isCurrency
            ? (() => {
                const numericValue =
                  typeof value === "number" ? value : Number(value);
                return Number.isFinite(numericValue)
                  ? compactCurrency.format(numericValue)
                  : "—";
              })()
            : value}
        </p>
        <p className="text-xs text-muted-foreground">{title}</p>
      </CardContent>
    </Card>
  );
}
