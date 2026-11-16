"use client";

import { useState, useTransition } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getForecast } from "@/lib/actions/leads";
import type { SafeForecast } from "@/lib/data/leads";
import type { FyQuarter } from "@/lib/leads/fy-quarter";
import { compactCurrency } from "@/utils/formatters";

/** Australian financial year: Q1 is Jul-Sep, not Jan-Mar. */
const QUARTERS: { q: FyQuarter; label: string }[] = [
  { q: 1, label: "Q1 Jul–Sep" },
  { q: 2, label: "Q2 Oct–Dec" },
  { q: 3, label: "Q3 Jan–Mar" },
  { q: 4, label: "Q4 Apr–Jun" },
];

export function ForecastPanel({
  forecast: initial,
}: {
  forecast: SafeForecast;
}) {
  const [forecast, setForecast] = useState(initial);
  const [pending, startTransition] = useTransition();

  function select(quarter: FyQuarter) {
    if (quarter === forecast.quarter) return;
    startTransition(async () => {
      setForecast(await getForecast(forecast.fy, quarter));
    });
  }

  const rows = [
    {
      label: "Expected to close",
      sub: `${forecast.dealCount} ${forecast.dealCount === 1 ? "deal" : "deals"} with a close date this quarter`,
      value: forecast.expectedValue,
    },
    {
      label: "Weighted",
      sub: "Discounted by stage likelihood",
      value: forecast.weightedValue,
    },
    {
      label: "Already won",
      sub: "Signed this quarter",
      value: forecast.wonValue,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {forecast.label || "Forecast"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-0.5 rounded-md border border-input bg-card p-0.5">
          {QUARTERS.map(({ q, label }) => {
            const isCurrent = forecast.quarter === q;
            return (
              <button
                key={q}
                type="button"
                onClick={() => select(q)}
                aria-pressed={isCurrent}
                disabled={pending}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                  isCurrent
                    ? "bg-royal-gold-light font-semibold text-royal-gold-ink-text"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
          >
            <span className="text-[12.5px]">
              {row.label}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {row.sub}
              </span>
            </span>
            <span className="whitespace-nowrap font-mono text-sm tabular-nums">
              {compactCurrency.format(Number(row.value))}
            </span>
          </div>
        ))}

        <div className="mt-3 rounded-md border border-success-light bg-success-light p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold">Banked</span>
            <span className="font-mono text-xl font-semibold tabular-nums">
              {compactCurrency.format(Number(forecast.bankedValue))}
            </span>
          </div>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Deals won, at full value. Everything still open is in Weighted.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
