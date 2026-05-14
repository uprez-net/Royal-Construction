"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

import { ChartCardShell } from "./chart-card-shell";

type LineSeries = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
};

export function LineChartCard<T extends Record<string, string | number>>({
  title,
  subtitle,
  action,
  data,
  xKey,
  yAxisFormatter,
  series,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  data: T[];
  xKey: keyof T;
  yAxisFormatter?: (value: number) => string;
  series: LineSeries[];
  className?: string;
}) {
  const chartConfig = series.reduce<ChartConfig>((acc, item) => {
    acc[item.key] = {
      label: item.label,
      color: item.color,
    };
    return acc;
  }, {});

  return (
    <ChartCardShell title={title} subtitle={subtitle} action={action}>
      <ChartContainer config={chartConfig} className={className ?? "h-[260px] w-full"}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={String(xKey)} tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => (yAxisFormatter ? yAxisFormatter(Number(value)) : `${value}`)}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {series.map((item) => (
            <Line
              key={item.key}
              dataKey={item.key}
              name={item.label}
              stroke={`var(--color-${item.key})`}
              strokeDasharray={item.dashed ? "4 4" : undefined}
              strokeWidth={item.dashed ? 2 : 2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              type="monotone"
            />
          ))}
        </LineChart>
      </ChartContainer>
    </ChartCardShell>
  );
}
