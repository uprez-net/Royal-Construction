'use client';

import React, { useMemo } from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  LineChart as RechartsLineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Lead, LeadStage } from '@/lib/leads/types';

interface AnalyticsViewProps {
  leads: Lead[];
}

/* ── Color palette (matching reference) ─────── */
const SOURCE_COLORS: Record<string, string> = {
  'Google Ads': '#0D9488',
  'Referral': '#16A34A',
  'Facebook Ads': '#F59E0B',
  'Walk-in': '#7C3AED',
  'Website': '#475569',
  'Repeat Client': '#0F172A',
  'Personal': '#2563EB',
  'Business': '#0F766E',
};

const LOST_REASON_COLORS = ['#DC2626', '#F59E0B', '#3ba6f1', '#7C3AED', '#a8a29e'];

/* ── Monthly trend mock data (as reference) ─── */
const MONTHLY_TREND = [
  { month: 'Jan', leads: 28, converted: 14 },
  { month: 'Feb', leads: 30, converted: 15 },
  { month: 'Mar', leads: 32, converted: 16 },
  { month: 'Apr', leads: 34, converted: 17 },
  { month: 'May', leads: 35, converted: 15 },
  { month: 'Jun', leads: 40, converted: 18 },
  { month: 'Jul', leads: 47, converted: 23 },
];

/* ── Lost reasons mock data (as reference) ──── */
const LOST_REASONS_DATA = [
  { name: 'Location Changed', value: 3 },
  { name: 'Budget Constraints', value: 5 },
  { name: 'Chose Competitor', value: 4 },
  { name: 'Delayed Decision', value: 2 },
  { name: 'Not Ready', value: 6 },
];

export default function AnalyticsView({ leads }: AnalyticsViewProps) {
  const analytics = useMemo(() => {
    /* Source distribution */
    const sourceMap = leads.reduce((acc, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sourceData = Object.entries(sourceMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    /* Conversion by source */
    const convMap = leads.reduce((acc, lead) => {
      if (!acc[lead.source]) acc[lead.source] = { total: 0, won: 0 };
      acc[lead.source].total++;
      if (lead.stage === 'Won') acc[lead.source].won++;
      return acc;
    }, {} as Record<string, { total: number; won: number }>);

    const conversionData = Object.entries(convMap).map(([source, stats]) => ({
      source,
      total: stats.total,
      won: stats.won,
    }));

    return { sourceData, conversionData };
  }, [leads]);

  /* ── Chart configs ─────────────────────────── */
  const sourceChartConfig: ChartConfig = {};
  analytics.sourceData.forEach(d => {
    sourceChartConfig[d.name] = {
      label: d.name,
      color: SOURCE_COLORS[d.name] || '#94A3B8',
    };
  });

  const trendChartConfig: ChartConfig = {
    leads: { label: 'Leads', color: '#0D9488' },
    converted: { label: 'Converted', color: '#16A34A' },
  };

  const convChartConfig: ChartConfig = {
    total: { label: 'Total', color: '#0D9488' },
    won: { label: 'Won', color: '#16A34A' },
  };

  const lostChartConfig: ChartConfig = {};
  LOST_REASONS_DATA.forEach((d, i) => {
    lostChartConfig[d.name] = {
      label: d.name,
      color: LOST_REASON_COLORS[i % LOST_REASON_COLORS.length],
    };
  });

  return (
    <div className="analytics-view">
      {/* ── Row 1: Lead Sources (5 col) + Monthly Trend (7 col) ── */}
      <div className="analytics-row">
        <div className="analytics-card analytics-card-small">
          <div className="analytics-card-header">
            <h3 className="analytics-card-title">Lead Sources</h3>
          </div>
          <div className="analytics-card-body">
            <ChartContainer config={sourceChartConfig} className="analytics-chart-container" style={{ height: 280 }}>
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
                      fill={SOURCE_COLORS[entry.name] || '#94A3B8'}
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
            <ChartContainer config={trendChartConfig} className="analytics-chart-container" style={{ height: 280 }}>
              <AreaChart data={MONTHLY_TREND}>
                <defs>
                  <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0D9488" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#0D9488" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="convertedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  domain={[0, 50]}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
                <Area
                  type="monotone"
                  dataKey="leads"
                  stroke="#0D9488"
                  strokeWidth={2.5}
                  fill="url(#leadsGradient)"
                  dot={{ r: 4, fill: '#0D9488', stroke: '#0D9488' }}
                  activeDot={{ r: 5, strokeWidth: 2 }}
                />
                <Area
                  type="monotone"
                  dataKey="converted"
                  stroke="#16A34A"
                  strokeWidth={2.5}
                  fill="url(#convertedGradient)"
                  dot={{ r: 4, fill: '#16A34A', stroke: '#16A34A' }}
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
            <ChartContainer config={convChartConfig} className="analytics-chart-container" style={{ height: 280 }}>
              <RechartsBarChart data={analytics.conversionData}>
                <CartesianGrid vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="source"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: '#94A3B8' }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
                <Bar
                  dataKey="total"
                  fill="#0D9488"
                  radius={[5, 5, 0, 0]}
                  barSize={18}
                />
                <Bar
                  dataKey="won"
                  fill="#16A34A"
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
            <ChartContainer config={lostChartConfig} className="analytics-chart-container analytics-chart-donut" style={{ height: 280 }}>
              <RechartsPieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={LOST_REASONS_DATA}
                  dataKey="value"
                  nameKey="name"
                  cx="40%"
                  cy="50%"
                  innerRadius="48%"
                  outerRadius="85%"
                  strokeWidth={0}
                  paddingAngle={1}
                >
                  {LOST_REASONS_DATA.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={LOST_REASON_COLORS[index % LOST_REASON_COLORS.length]}
                    />
                  ))}
                </Pie>
                <ChartLegend
                  content={<ChartLegendContent nameKey="name" className="analytics-lost-legend" />}
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
