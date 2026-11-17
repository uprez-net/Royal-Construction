"use client";

import { KpiBand } from "@/components/common/kpi-band";
import { MetricCard } from "@/components/common/metric-card";
import type { SafeForecast, SafePipelineMetrics } from "@/lib/data/leads";

interface PipelineKpiProps {
  metrics: SafePipelineMetrics;
  forecast: SafeForecast;
}

/**
 * The four headline pipeline figures.
 *
 * Open vs Weighted side by side is the point of the whole feature: raw
 * pipeline overstates what is coming, the weighted figure does not.
 */
export function PipelineKpi({ metrics, forecast }: PipelineKpiProps) {
  const { winRate } = metrics;

  return (
    <div className="flex flex-col gap-2">
      <KpiBand className="md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Open Pipeline Value"
          value={metrics.totalValue}
          isCurrency
        />
        <MetricCard
          title="Weighted Pipeline"
          value={metrics.weightedValue}
          isCurrency
        />
        <MetricCard
          // An em dash, never 0% — "no deals closed" and "we lost everything"
          // are different statements and must not look alike.
          title={`Win Rate (${winRate.windowDays} days)`}
          value={winRate.percent === null ? "—" : `${winRate.percent}%`}
          caption={`${winRate.won} won · ${winRate.lost} lost`}
        />
        <MetricCard
          title={
            forecast.label
              ? `Banked · ${forecast.label}`
              : "Banked This Quarter"
          }
          value={forecast.bankedValue}
          isCurrency
        />
      </KpiBand>

      {winRate.estimatedDates ? (
        <p className="px-0.5 text-[11.5px] text-muted-foreground">
          Win rate counts decisions, not dollars. It includes estimated close
          dates for deals settled before tracking began — accurate from here on,
          and this note clears itself once the window passes.
        </p>
      ) : null}
    </div>
  );
}
