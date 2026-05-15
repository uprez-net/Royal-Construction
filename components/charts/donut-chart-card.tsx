"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

import { ChartCardShell } from "./chart-card-shell";

export function DonutChartCard<T extends Record<string, string | number>>({
  title,
  subtitle,
  data,
  labelKey,
  valueKey,
  colorByLabel,
}: {
  title: string;
  subtitle?: string;
  data: T[];
  labelKey: keyof T;
  valueKey: keyof T;
  colorByLabel: Record<string, string>;
}) {
  const chartConfig = data.reduce<ChartConfig>((acc, row) => {
    const label = String(row[labelKey]);
    acc[label] = {
      label,
      color: colorByLabel[label] ?? "var(--chart-1)",
    };
    return acc;
  }, {});

  return (
    <ChartCardShell title={title} subtitle={subtitle}>
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend
            content={<ChartLegendContent nameKey={String(labelKey)} />}
          />
          <Pie
            data={data}
            dataKey={String(valueKey)}
            nameKey={String(labelKey)}
            innerRadius={58}
            outerRadius={84}
            paddingAngle={4}
            strokeWidth={0}
          >
            {data.map((row) => {
              const label = String(row[labelKey]);

              return (
                <Cell
                  key={label}
                  fill={colorByLabel[label] ?? "hsl(var(--chart-1))"}
                />
              );
            })}
          </Pie>
        </PieChart>
      </ChartContainer>
    </ChartCardShell>
  );
}
