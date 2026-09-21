"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafePipelineMetrics } from "@/lib/data/leads";
import { compactCurrency } from "@/utils/formatters";

interface PipelineStageChartProps {
  metrics: SafePipelineMetrics;
}

/**
 * Open pipeline value broken down by stage.
 *
 * Bar LENGTH is face value; the filled portion is the weighted share. The
 * unfilled remainder is therefore the probability discount itself — the chart
 * shows why the weighted number is what it is, which two side-by-side bars
 * would not.
 */
export function PipelineStageChart({ metrics }: PipelineStageChartProps) {
  const maxTotal = metrics.byStage.reduce(
    (max, bucket) => Math.max(max, Number(bucket.total)),
    0,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base">Where the money sits</CardTitle>
        <span className="text-[11.5px] text-muted-foreground">
          Open leads only
        </span>
      </CardHeader>
      <CardContent className="flex flex-col">
        {metrics.byStage.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open leads with a deal value yet. Values fill in automatically as
            offers are priced.
          </p>
        ) : (
          <>
            {metrics.byStage.map((bucket) => {
              const total = Number(bucket.total);
              const barWidth = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
              return (
                <div
                  key={bucket.code}
                  className="flex flex-col gap-1.5 border-t border-dashed border-border py-2.5 first:border-t-0"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold">
                      {bucket.label}
                    </span>
                    <span className="rounded bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground">
                      {bucket.probability}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {bucket.count} {bucket.count === 1 ? "lead" : "leads"}
                    </span>
                    <span className="ml-auto font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      <b className="font-medium text-foreground">
                        {compactCurrency.format(total)}
                      </b>{" "}
                      → {compactCurrency.format(Number(bucket.weighted))}
                    </span>
                  </div>
                  <div
                    className="h-3.5 overflow-hidden rounded-sm bg-border/55"
                    style={{ width: `${barWidth}%` }}
                    role="img"
                    aria-label={`${bucket.label}: ${compactCurrency.format(total)} face value, ${compactCurrency.format(Number(bucket.weighted))} weighted at ${bucket.probability}%`}
                  >
                    <div
                      className="h-full rounded-l-sm"
                      style={{
                        width: `${bucket.probability}%`,
                        background: `var(${bucket.colorVar})`,
                      }}
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-3 flex flex-wrap justify-between gap-3 border-t-2 border-foreground pt-3 text-[12.5px]">
              <span>
                {metrics.openCount} open{" "}
                {metrics.openCount === 1 ? "lead" : "leads"}
              </span>
              <span className="font-mono tabular-nums">
                Face {compactCurrency.format(Number(metrics.totalValue))} →
                Weighted {compactCurrency.format(Number(metrics.weightedValue))}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
