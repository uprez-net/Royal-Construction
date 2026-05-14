"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

import { ChartCardShell } from "./chart-card-shell";

export function HorizontalBarChartCard<T extends Record<string, string | number>>({
  title,
  subtitle,
  action,
  data,
  categoryKey,
  valueKey,
  valueLabel,
  color = "#0D9488",
  xAxisFormatter,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  data: T[];
  categoryKey: keyof T;
  valueKey: keyof T;
  valueLabel?: string;
  color?: string;
  xAxisFormatter?: (value: number) => string;
}) {
  const config: ChartConfig = {
    [String(valueKey)]: {
      label: valueLabel ?? String(valueKey),
      color,
    },
  };

  return (
    <ChartCardShell title={title} subtitle={subtitle} action={action}>
      <ChartContainer config={config} className="h-70 w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <YAxis type="category" dataKey={String(categoryKey)} tickLine={false} axisLine={false} width={120} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => (xAxisFormatter ? xAxisFormatter(Number(value)) : `${value}`)}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey={String(valueKey)} fill={`var(--color-${String(valueKey)})`} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ChartContainer>
    </ChartCardShell>
  );
}
