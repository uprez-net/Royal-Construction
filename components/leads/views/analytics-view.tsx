"use client";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { LeadAnalyticsData } from "@/types/lead";
import { randomColourHexGenerator } from "@/utils/generator";

interface AnalyticsViewProps {
  analytics: LeadAnalyticsData;
}

/* ── BuildPro chart tokens ─────── */
const CHART = {
  lead: "var(--royal-gold)",
  success: "var(--success)",
  warning: "var(--warning)",
  info: "var(--info)",
  purple: "var(--accent-purple)",
  muted: "var(--muted-foreground)",
  foreground: "var(--foreground)",
  border: "var(--border)",
};

const SOURCE_COLORS: Record<string, string> = {
  "Google Ads": CHART.lead,
  Referral: CHART.success,
  "Facebook Ads": CHART.warning,
  "Walk-in": CHART.purple,
  Website: CHART.muted,
  "Repeat Client": CHART.foreground,
  Personal: CHART.info,
  Business: "var(--primary)",
};

export default function AnalyticsView({ analytics }: AnalyticsViewProps) {
  /* ── Chart configs ─────────────────────────── */
  const sourceChartConfig: ChartConfig = {};
  analytics.sourceData.forEach((d) => {
    sourceChartConfig[d.name] = {
      label: d.name,
      color: SOURCE_COLORS[d.name] || CHART.muted,
    };
  });

  const trendChartConfig: ChartConfig = {
    leads: { label: "Leads", color: CHART.lead },
    converted: { label: "Converted", color: CHART.success },
  };

  const convChartConfig: ChartConfig = {
    total: { label: "Total", color: CHART.lead },
    won: { label: "Won", color: CHART.success },
  };

  const lostChartConfig: ChartConfig = {};
  analytics.lostReasons.forEach((d) => {
    lostChartConfig[d.name] = {
      label: d.name,
      color: randomColourHexGenerator(d.name), // You can replace this with a fixed color if you want consistent colors for lost reasons
    };
  });

  const topSource = [...analytics.sourceData].sort((a, b) => b.value - a.value)[0];
  const latestMonth = analytics.monthlyTrend.at(-1);
  const topLostReason = [...analytics.lostReasons].sort((a, b) => b.value - a.value)[0];

  return (
    <div className="analytics-view">
      <div className="analytics-summary" aria-label="Lead analytics summary">
        <div>
          <span>Top source</span>
          <strong>{topSource ? `${topSource.name} (${topSource.value})` : "No source data"}</strong>
        </div>
        <div>
          <span>Latest month</span>
          <strong>
            {latestMonth
              ? `${latestMonth.month}: ${latestMonth.leads} leads, ${latestMonth.converted} converted`
              : "No monthly data"}
          </strong>
        </div>
        <div>
          <span>Top lost reason</span>
          <strong>
            {topLostReason ? `${topLostReason.name} (${topLostReason.value})` : "No lost reason data"}
          </strong>
        </div>
      </div>
      {/* ── Row 1: Lead Sources (5 col) + Monthly Trend (7 col) ── */}
      <div className="analytics-row">
        <div className="analytics-card analytics-card-small">
          <div className="analytics-card-header">
            <h3 className="analytics-card-title">Lead Sources</h3>
          </div>
          <div className="analytics-card-body">
            <ChartContainer
              config={sourceChartConfig}
              className="analytics-chart-container"
              style={{ height: 280 }}
            >
              <RechartsPieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={analytics.sourceData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="85%"
                  strokeWidth={0}
                  paddingAngle={2}
                >
                  {analytics.sourceData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={SOURCE_COLORS[entry.name] || CHART.muted}
                    />
                  ))}
                </Pie>
                <ChartLegend
                  content={<ChartLegendContent nameKey="name" />}
                  verticalAlign="bottom"
                />
              </RechartsPieChart>
            </ChartContainer>
          </div>
        </div>

        <div className="analytics-card analytics-card-large">
          <div className="analytics-card-header">
            <h3 className="analytics-card-title">Monthly Lead Trend</h3>
          </div>
          <div className="analytics-card-body">
            <ChartContainer
              config={trendChartConfig}
              className="analytics-chart-container"
              style={{ height: 280 }}
            >
              <AreaChart data={analytics.monthlyTrend}>
                <defs>
                  <linearGradient
                    id="leadsGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={CHART.lead} stopOpacity={0.15} />
                    <stop
                      offset="100%"
                      stopColor={CHART.lead}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                  <linearGradient
                    id="convertedGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={CHART.success} stopOpacity={0.15} />
                    <stop
                      offset="100%"
                      stopColor={CHART.success}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={CHART.border} />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: CHART.muted }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: CHART.muted }}
                  domain={[0, 50]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend
                  content={<ChartLegendContent />}
                  verticalAlign="top"
                />
                <Area
                  type="monotone"
                  dataKey="leads"
                  stroke={CHART.lead}
                  strokeWidth={2.5}
                  fill="url(#leadsGradient)"
                  dot={{ r: 4, fill: CHART.lead, stroke: CHART.lead }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="converted"
                  stroke={CHART.success}
                  strokeWidth={2.5}
                  fill="url(#convertedGradient)"
                  dot={{ r: 4, fill: CHART.success, stroke: CHART.success }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </div>
      </div>

      {/* ── Row 2: Conversion by Source (5 col) + Lost Reasons (7 col) ── */}
      <div className="analytics-row">
        <div className="analytics-card analytics-card-small">
          <div className="analytics-card-header">
            <h3 className="analytics-card-title">Conversion by Source</h3>
          </div>
          <div className="analytics-card-body">
            <ChartContainer
              config={convChartConfig}
              className="analytics-chart-container"
              style={{ height: 280 }}
            >
              <RechartsBarChart data={analytics.conversionData}>
                <CartesianGrid vertical={false} stroke={CHART.border} />
                <XAxis
                  dataKey="source"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: CHART.muted }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: CHART.muted }}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend
                  content={<ChartLegendContent />}
                  verticalAlign="top"
                />
                <Bar
                  dataKey="total"
                  fill={CHART.lead}
                  radius={[5, 5, 0, 0]}
                  barSize={18}
                />
                <Bar
                  dataKey="won"
                  fill={CHART.success}
                  radius={[5, 5, 0, 0]}
                  barSize={18}
                />
              </RechartsBarChart>
            </ChartContainer>
          </div>
        </div>

        <div className="analytics-card analytics-card-large">
          <div className="analytics-card-header">
            <h3 className="analytics-card-title">Lost Reasons</h3>
          </div>
          <div className="analytics-card-body">
            <ChartContainer
              config={lostChartConfig}
              className="analytics-chart-container analytics-chart-donut"
              style={{ height: 280 }}
            >
              <RechartsPieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={analytics.lostReasons}
                  dataKey="value"
                  nameKey="name"
                  cx="40%"
                  cy="50%"
                  innerRadius="48%"
                  outerRadius="85%"
                  strokeWidth={0}
                  paddingAngle={1}
                >
                  {Object.values(lostChartConfig).map((entry) => (
                    <Cell key={entry.label as string} fill={entry.color} />
                  ))}
                </Pie>
                <ChartLegend
                  content={
                    <ChartLegendContent
                      nameKey="name"
                      className="analytics-lost-legend"
                    />
                  }
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                />
              </RechartsPieChart>
            </ChartContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
