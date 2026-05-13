"use client";

import { Pie, PieChart, ResponsiveContainer, Cell, Tooltip } from "recharts";

import { AlertTriangle, CheckCircle2, Clock3, PhoneMissed, UserRound } from "lucide-react";

import { DataTable } from "@/components/common/data-table";
import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal, setTradieFilter } from "@/lib/store/slices/uiSlice";
import type { SafeTradie, TradieKPIs, TradieScheduleWithTradieMilestoneAndProject } from "@/types/project";

const chartColors: Record<string, string> = {
  CONFIRMED: "#10b981",
  PENDING: "#f59e0b",
  PENDING_RESPONSE: "#3b82f6",
  NO_RESPONSE: "#9ca3af",
  DECLINED: "#ef4444",
  COMPLETED: "#0f766e",
};

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function TradiesClient({
  tradies,
  schedules,
  kpis,
}: {
  tradies: SafeTradie[];
  schedules: TradieScheduleWithTradieMilestoneAndProject[];
  kpis: TradieKPIs;
}) {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((state) => state.ui.tradieFilters);
  const replacementRequired = useAppSelector((state) => state.tradies.replacementRequired);

  const tradeTypes = Array.from(new Set(tradies.map((tradie) => tradie.tradeType))).sort();

  const filteredSchedules = schedules.filter((schedule) => {
    const tradeTypeMatch = !filters.tradeType || schedule.tradie.tradeType === filters.tradeType;
    const statusMatch = !filters.status || schedule.status === filters.status;
    return tradeTypeMatch && statusMatch;
  });

  const sortedSchedules = [...filteredSchedules].sort((left, right) => {
    const factor = filters.order === "asc" ? 1 : -1;
    if (filters.sort === "tradieName") return left.tradie.name.localeCompare(right.tradie.name) * factor;
    if (filters.sort === "projectName") return left.project.name.localeCompare(right.project.name) * factor;
    return (left.scheduledDate.getTime() - right.scheduledDate.getTime()) * factor;
  });

  const urgentSchedules = sortedSchedules.filter((schedule) => {
    const scheduledDate = schedule.scheduledDate.getTime();
    const upperBound = new Date();
    upperBound.setDate(upperBound.getDate() + 7);
    return scheduledDate <= upperBound.getTime() && schedule.status !== "CONFIRMED" && schedule.status !== "COMPLETED";
  });

  const chartData = [
    { name: "Confirmed", value: kpis.confirmed, status: "CONFIRMED" },
    { name: "Pending", value: kpis.pending, status: "PENDING" },
    { name: "Pending Response", value: kpis.pendingResponse, status: "PENDING_RESPONSE" },
    { name: "No Response", value: kpis.noResponse, status: "NO_RESPONSE" },
    { name: "Declined", value: kpis.declined, status: "DECLINED" },
  ].filter((item) => item.value > 0);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total Scheduled" value={String(kpis.totalScheduled)} note="All tradie schedules in the database" tone="primary" icon={Clock3} />
        <MetricCard label="Confirmed" value={String(kpis.confirmed)} note="Locked-in schedules" tone="success" icon={CheckCircle2} />
        <MetricCard label="Pending" value={String(kpis.pending)} note="Awaiting first response" tone="warning" icon={AlertTriangle} />
        <MetricCard label="No Response" value={String(kpis.noResponse)} note="Calls that went unanswered" tone="danger" icon={PhoneMissed} />
        <MetricCard label="Declined" value={String(kpis.declined)} note="Jobs needing a replacement" tone="danger" icon={UserRound} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <SectionCard title="Tradie Schedule" description="Sort and filter happen on the client from the cached server payload.">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => dispatch(openModal({ type: "tradieDirectory" }))}>
              Tradie Directory
            </Button>
            <Button type="button" variant="outline" onClick={() => dispatch(openModal({ type: "scheduleTradie" }))}>
              Schedule Tradie
            </Button>
            <Button type="button" variant="outline" onClick={() => dispatch(openModal({ type: "createTradie" }))}>
              Add Tradie
            </Button>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              value={filters.tradeType ?? ""}
              onChange={(event) => dispatch(setTradieFilter({ tradeType: event.target.value || null }))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All trades</option>
              {tradeTypes.map((tradeType) => (
                <option key={tradeType} value={tradeType}>
                  {tradeType}
                </option>
              ))}
            </select>
            <select
              value={filters.status ?? ""}
              onChange={(event) => dispatch(setTradieFilter({ status: event.target.value || null }))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All statuses</option>
              {(["PENDING", "PENDING_RESPONSE", "CONFIRMED", "NO_RESPONSE", "DECLINED", "COMPLETED"] as const).map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
            <div className="inline-flex rounded-full border border-border bg-background p-1">
              {(["scheduledDate", "tradieName", "projectName"] as const).map((sortKey) => (
                <Button
                  key={sortKey}
                  type="button"
                  size="sm"
                  variant={filters.sort === sortKey ? "default" : "ghost"}
                  onClick={() =>
                    dispatch(
                      setTradieFilter({
                        sort: sortKey,
                        order: filters.sort === sortKey && filters.order === "asc" ? "desc" : "asc",
                      }),
                    )
                  }
                >
                  {sortKey === "scheduledDate" ? "Date" : sortKey === "tradieName" ? "Tradie" : "Project"}
                </Button>
              ))}
            </div>
          </div>

          <DataTable
            headers={["Tradie Name", "Trade Type", "Company", "Project", "Milestone", "Scheduled Date", "Duration", "Status"]}
            rows={sortedSchedules.map((schedule) => [
              schedule.tradie.name,
              schedule.tradie.tradeType,
              schedule.tradie.company ?? "Independent",
              schedule.project.name,
              <span key={`${schedule.id}-milestone`} className={replacementRequired.includes(schedule.milestone?.id ?? "") ? "font-medium text-red-600" : undefined}>
                {schedule.milestone?.name ?? "Unassigned"}
              </span>,
              <span key={`${schedule.id}-date`} className="font-mono">
                {dateFormat.format(schedule.scheduledDate)}
              </span>,
              `${schedule.durationDays} day${schedule.durationDays === 1 ? "" : "s"}`,
              <StatusPill key={schedule.id} tone={schedule.status === "DECLINED" ? "danger" : schedule.status === "CONFIRMED" ? "success" : schedule.status === "NO_RESPONSE" || schedule.status === "PENDING_RESPONSE" ? "warning" : "neutral"}>
                {formatStatus(schedule.status)}
              </StatusPill>,
            ])}
          />

          {sortedSchedules.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              No schedules match the current filters.
            </div>
          ) : null}
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="Urgent Reminders" description="Schedules due in the next 7 days that still need confirmation.">
            <div className="space-y-3">
              {urgentSchedules.length > 0 ? (
                urgentSchedules.map((schedule) => (
                  <div key={schedule.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-950">{schedule.tradie.name}</p>
                        <p className="text-sm text-muted-foreground">{schedule.tradie.tradeType}</p>
                        <p className="text-sm text-slate-700">{schedule.project.name}</p>
                      </div>
                      <StatusPill tone={schedule.status === "DECLINED" ? "danger" : "warning"}>Due {dateFormat.format(schedule.scheduledDate)}</StatusPill>
                    </div>
                    <div className="mt-3">
                      <Button type="button" size="sm" variant="outline" onClick={() => dispatch(openModal({ type: "logCall", payload: { schedule } }))}>
                        Log Call
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-2 size-5 text-emerald-600" />
                  No urgent reminders.
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Status Breakdown" description="Schedule status distribution from the current KPI payload.">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={86} paddingAngle={3}>
                    {chartData.map((entry) => (
                      <Cell key={entry.status} fill={chartColors[entry.status]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}