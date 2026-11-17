"use client";

import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GraphCard } from "@/components/common/graph-card";
import type { DashboardGraphData } from "@/lib/data/dashboard";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { isWithinInterval, startOfYear, subMonths } from "date-fns";

// ─── Shared tokens ────────────────────────────────────────────────────────────
// Chart series are the warm chart tokens, in a fixed order: gold is series 1.
const SERIES_GOLD = "var(--chart-1)";
const SERIES_GREEN = "var(--chart-2)";
const SERIES_ORANGE = "var(--chart-3)";
const AXIS_TICK = "var(--muted-foreground)";
const GRID_LINE = "var(--border)";
const SLICE_SEPARATOR = "var(--card)";
const TOOLTIP_BORDER = "1px solid var(--border)";
const NON_CONVERSION_COLORS = [
  SERIES_GOLD,
  SERIES_GREEN,
  SERIES_ORANGE,
  "var(--chart-5)",
  AXIS_TICK,
];
const CONVERSION_COLORS = {
  CONVERTED: "var(--success)",
  PENDING: "var(--warning)",
  LOST: "var(--destructive)",
  NURTURE: SERIES_GOLD,
};

const formatCurrency = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;

const formatProjectCurrency = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;

// ─── Leads & Revenue Overview ─────────────────────────────────────────────────
function LeadsRevenueChart({
  data,
}: {
  data: DashboardGraphData["leadAndRevenueData"];
}) {
  const formatted = data.map((d) => ({
    month: format(new Date(d.month), "MMM"),
    leads: d.leads,
    converted: d.converted,
    revenue: d.revenue,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart
        data={formatted}
        margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={GRID_LINE} />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: AXIS_TICK }}
        />
        {/* Left axis — lead counts */}
        <YAxis
          yAxisId="left"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: AXIS_TICK }}
          domain={[0, "dataMax + 10"]}
        />
        {/* Right axis — revenue */}
        <YAxis
          yAxisId="right"
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: AXIS_TICK }}
          tickFormatter={formatCurrency}
        />
        <Tooltip
          formatter={(value, name) => {
            if (name === "Revenue ($K)")
              return [formatCurrency(value as number), name];
            return [value, name];
          }}
          contentStyle={{
            border: TOOLTIP_BORDER,
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend
          iconType="square"
          iconSize={10}
          wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
        />
        <Bar
          yAxisId="left"
          dataKey="leads"
          name="New Leads"
          fill={SERIES_GOLD}
          radius={[3, 3, 0, 0]}
          barSize={22}
        />
        <Bar
          yAxisId="left"
          dataKey="converted"
          name="Converted"
          fill={SERIES_GREEN}
          radius={[3, 3, 0, 0]}
          barSize={22}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="revenue"
          name="Revenue ($K)"
          stroke={SERIES_ORANGE}
          strokeWidth={2}
          dot={{ r: 3, fill: SERIES_ORANGE, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Conversion Breakdown ─────────────────────────────────────────────────────
function ConversionBreakdownChart({
  data,
}: {
  data: DashboardGraphData["conversionBreakdownData"];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  const colorMap: Record<string, string> = {
    converted: CONVERSION_COLORS.CONVERTED,
    pending: CONVERSION_COLORS.PENDING,
    lost: CONVERSION_COLORS.LOST,
    nurture: CONVERSION_COLORS.NURTURE,
  };

  const labelMap: Record<string, string> = {
    converted: "Converted",
    pending: "Pending",
    lost: "Lost",
    nurture: "Nurture",
  };

  const conversionRate = data.find((d) => d.stage === "converted");
  const lossRate = data.find((d) => d.stage === "lost");

  const convPct = conversionRate
    ? ((conversionRate.value / total) * 100).toFixed(1)
    : "0";
  const lossPct = lossRate ? ((lossRate.value / total) * 100).toFixed(1) : "0";

  return (
    <div className="flex flex-col gap-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="stage"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            strokeWidth={2}
            stroke={SLICE_SEPARATOR}
          >
            {data.map((entry) => (
              <Cell
                key={entry.stage}
                fill={colorMap[entry.stage] ?? SERIES_GOLD}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${(((value as number) / total) * 100).toFixed(1)}%`,
              labelMap[name as string] ?? name,
            ]}
            contentStyle={{
              border: TOOLTIP_BORDER,
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Custom legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {data.map((entry) => (
          <span
            key={entry.stage}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorMap[entry.stage] ?? SERIES_GOLD }}
            />
            {labelMap[entry.stage] ?? entry.stage} (
            {((entry.value / total) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 divide-x divide-border rounded-lg border">
        <div className="flex flex-col items-center py-3">
          <span className="text-xl font-semibold text-foreground">
            {convPct}%
          </span>
          <span className="text-xs text-muted-foreground">Conversion Rate</span>
        </div>
        <div className="flex flex-col items-center py-3">
          <span className="text-xl font-semibold text-destructive">
            {lossPct}%
          </span>
          <span className="text-xs text-muted-foreground">Loss Rate</span>
        </div>
      </div>
    </div>
  );
}

// ─── Non-Conversion Reasons ───────────────────────────────────────────────────
function NonConversionChart({
  data,
}: {
  data: DashboardGraphData["nonConversionData"];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex flex-row items-center gap-4">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            strokeWidth={2}
            stroke={SLICE_SEPARATOR}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={
                  NON_CONVERSION_COLORS[index % NON_CONVERSION_COLORS.length]
                }
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [
              `${(((value as number) / total) * 100).toFixed(1)}%`,
              name,
            ]}
            contentStyle={{
              border: TOOLTIP_BORDER,
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Custom legend */}
      <div className="flex flex-col gap-1.5 w-40">
        {data.map((entry, index) => (
          <span
            key={entry.name}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background:
                  NON_CONVERSION_COLORS[index % NON_CONVERSION_COLORS.length],
              }}
            />
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Estimation vs Actual Cost by Project ─────────────────────────────────────
function EstVsSpendChart({
  data,
}: {
  data: DashboardGraphData["estVsSpendProjectData"];
}) {
  const formatted = data.map((d) => ({
    project: format(new Date(d.month), "MMM yyyy"),
    estimated: d.estimateSpend,
    actual: d.actualSpend,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={formatted}
        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} stroke={GRID_LINE} />
        <XAxis
          dataKey="project"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: AXIS_TICK }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 12, fill: AXIS_TICK }}
          tickFormatter={formatProjectCurrency}
        />
        <Tooltip
          formatter={(value, name) => [
            formatProjectCurrency(value as number),
            name,
          ]}
          contentStyle={{
            border: TOOLTIP_BORDER,
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend
          iconType="square"
          iconSize={10}
          wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
        />
        <Bar
          dataKey="estimated"
          name="Estimated ($K)"
          fill={SERIES_GOLD}
          radius={[3, 3, 0, 0]}
          barSize={20}
        />
        <Bar
          dataKey="actual"
          name="Actual ($K)"
          fill={SERIES_GREEN}
          radius={[3, 3, 0, 0]}
          barSize={20}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────
export function DashboardGraphCards({ data }: { data: DashboardGraphData }) {
  const [selectedPeriod, setSelectedPeriod] = useState<"6M" | "12M" | "YTD">(
    "YTD",
  );
  const filteredLeadRevenueData = useMemo(() => {
    const now = new Date();

    const startDate =
      selectedPeriod === "6M"
        ? subMonths(now, 6)
        : selectedPeriod === "12M"
          ? subMonths(now, 12)
          : startOfYear(now);

    return data.leadAndRevenueData.filter((d) =>
      isWithinInterval(new Date(d.month), {
        start: startDate,
        end: now,
      }),
    );
  }, [data.leadAndRevenueData, selectedPeriod]);
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <GraphCard
          title="Leads & Revenue Overview"
          actionNode={
            <div className="rounded-md bg-muted p-0.5 text-xs font-medium gap-2">
              {(["6M", "12M", "YTD"] as const).map((period) => (
                <Button
                  key={period}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "px-2",
                    selectedPeriod === period
                      ? "bg-royal-gold-light text-royal-gold-ink hover:bg-royal-gold-light"
                      : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                  )}
                  onClick={() => setSelectedPeriod(period)}
                >
                  {period}
                </Button>
              ))}
            </div>
          }
          graphNode={
            <LeadsRevenueChart
              key={selectedPeriod}
              data={filteredLeadRevenueData}
            />
          }
        />
        <GraphCard
          title="Conversion Breakdown"
          graphNode={
            <ConversionBreakdownChart data={data.conversionBreakdownData} />
          }
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.45fr]">
        <GraphCard
          title="Non-Conversion Reasons"
          graphNode={<NonConversionChart data={data.nonConversionData} />}
        />
        <GraphCard
          title="Estimation vs Actual Cost by Project"
          graphNode={<EstVsSpendChart data={data.estVsSpendProjectData} />}
        />
      </div>
    </>
  );
}
