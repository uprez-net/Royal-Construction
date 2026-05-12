import { AlertTriangle, CheckCircle2, Clock3, PhoneMissed, UserRound } from "lucide-react";

import { MetricCard } from "@/components/common/metric-card";
import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { DataTable } from "@/components/common/data-table";
import { getTradieScheduleKPIs, getTradieSchedules, getTradies } from "@/lib/data/tradies";

import { TradieFilters } from "./tradie-filters";
import { TradiesActions } from "./tradies-actions";
import { UrgentReminderActions } from "./urgent-reminder-actions";

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

function statusTone(status: string) {
  if (status === "CONFIRMED" || status === "COMPLETED") {
    return "success";
  }

  if (status === "DECLINED") {
    return "danger";
  }

  if (status === "NO_RESPONSE" || status === "PENDING_RESPONSE") {
    return "warning";
  }

  return "neutral";
}

function parseValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function parseScheduleStatus(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value as
    | "PENDING"
    | "PENDING_RESPONSE"
    | "CONFIRMED"
    | "NO_RESPONSE"
    | "DECLINED"
    | "COMPLETED";
}

export async function TradiesScreen({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tradeType = parseValue(searchParams?.trade);
  const status = parseScheduleStatus(parseValue(searchParams?.status));
  const sort = parseValue(searchParams?.sort) as "scheduledDate" | "tradieName" | "projectName" | undefined;
  const order = parseValue(searchParams?.order) as "asc" | "desc" | undefined;

  const [schedules, kpis, tradies, allSchedules] = await Promise.all([
    getTradieSchedules({ tradeType, status, sort, order }),
    getTradieScheduleKPIs(),
    getTradies(),
    getTradieSchedules({ sort: "scheduledDate", order: "asc" }),
  ]);

  const urgentSchedules = allSchedules.filter((schedule) => {
    const scheduledDate = schedule.scheduledDate.getTime();
    const upperBound = new Date();
    upperBound.setDate(upperBound.getDate() + 7);
    return scheduledDate <= upperBound.getTime() && schedule.status !== "CONFIRMED" && schedule.status !== "COMPLETED";
  });

  const tradeTypes = Array.from(new Set(tradies.map((tradie) => tradie.tradeType))).sort();

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
        <SectionCard
          title="Tradie Schedule"
          description="Sort and filter happen on the server; the client controls the query string only."
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TradieFilters tradeTypes={tradeTypes} />
            <TradiesActions />
          </div>
          <DataTable
            headers={[
              "Tradie Name",
              "Trade Type",
              "Company",
              "Project",
              "Milestone",
              "Scheduled Date",
              "Duration",
              "Status",
            ]}
            rows={schedules.map((schedule) => [
              schedule.tradie.name,
              schedule.tradie.tradeType,
              schedule.tradie.company ?? "Independent",
              schedule.project.name,
              schedule.milestone?.name ?? "Unassigned",
              dateFormat.format(schedule.scheduledDate),
              `${schedule.durationDays} day${schedule.durationDays === 1 ? "" : "s"}`,
              <StatusPill key={schedule.id} tone={statusTone(schedule.status)}>
                {formatStatus(schedule.status)}
              </StatusPill>,
            ])}
          />
        </SectionCard>

        <SectionCard title="Urgent Reminders" description="Schedules due in the next 7 days that still need confirmation.">
          <div className="space-y-3">
            {urgentSchedules.length > 0 ? (
              urgentSchedules.map((schedule) => (
                <div key={schedule.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{schedule.tradie.name}</p>
                      <p className="text-sm text-muted-foreground">{schedule.project.name}</p>
                      <p className="text-sm text-slate-700">{schedule.milestone?.name ?? "Unassigned milestone"}</p>
                    </div>
                    <StatusPill tone="warning">Due {dateFormat.format(schedule.scheduledDate)}</StatusPill>
                  </div>
                  <div className="mt-3">
                    <UrgentReminderActions schedule={schedule} />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                No reminder items due in the next seven days.
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
