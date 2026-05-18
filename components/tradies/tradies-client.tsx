"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { TradieScheduleStatus } from "@prisma/client";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  EllipsisVertical,
  Eye,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  Search,
  TriangleAlert,
  Users,
} from "lucide-react";

import { DonutChartCard } from "@/components/charts/donut-chart-card";
import { HorizontalBarChartCard } from "@/components/charts/horizontal-bar-chart-card";
import { SearchableSelect } from "@/components/common/searchable-select";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  clearSelectedSchedules,
  fetchTradieCoordinationDashboard,
  fetchTradieProjectLookup,
  hydrateTradieCoordination,
  setSelectedSchedules,
  setTradieFilters,
  setTradiePage,
  setTradies,
  toggleScheduleSelection, updateTradieScheduleStatus,
} from "@/lib/store/slices/tradiesSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type {
  SafeTradie,
  TradieCoordinationDashboard,
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { dataTimeFormat } from "@/utils/formatters";
import { DataTable } from "../common/data-table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const statusLabelMap: Record<TradieScheduleStatus, string> = {
  PENDING: "Pending",
  PENDING_RESPONSE: "Pending Response",
  CONFIRMED: "Confirmed",
  NO_RESPONSE: "No Response",
  DECLINED: "Declined",
  COMPLETED: "Completed",
};

const statusToneMap: Record<
  TradieScheduleStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  PENDING: "warning",
  PENDING_RESPONSE: "warning",
  CONFIRMED: "success",
  NO_RESPONSE: "danger",
  DECLINED: "danger",
  COMPLETED: "neutral",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function daysUntil(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  return Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function TrendBadge({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold",
        isPositive
          ? "bg-emerald-100 text-emerald-700"
          : "bg-red-100 text-red-700",
      ].join(" ")}
    >
      {isPositive ? "+" : ""}
      {value}
    </span>
  );
}

function CalanderRow(scheduledData: string): ReactNode {
  const daysLeft = daysUntil(scheduledData);

  if (daysLeft < 0) {
    return (
      <>
        <CircleAlert className="h-4 w-4 text-gray-500" />
        <span>{Math.abs(daysLeft)}d overdue</span>
      </>
    );
  }

  if (daysLeft === 0) {
    return (
      <>
        <CircleAlert className="h-4 w-4 text-red-600" />
        <span>Due today</span>
      </>
    );
  }

  if (daysLeft <= 4) {
    return (
      <>
        <TriangleAlert className="h-4 w-4 text-amber-600" />
        <span>{daysLeft}d left</span>
      </>
    );
  }

  return (
    <>
      <Calendar className="h-4 w-4 text-green-600" />
      <span>{daysLeft}d left</span>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
      <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
      <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

export function TradiesClient({
  initialDashboard,
  initialTradies,
}: {
  initialDashboard: TradieCoordinationDashboard;
  initialTradies: SafeTradie[];
}) {
  const dispatch = useAppDispatch();
  const tradiesState = useAppSelector((state) => state.tradies);

  const [searchInput, setSearchInput] = useState(initialDashboard.query.search);
  const [projectSearch, setProjectSearch] = useState("");
  const [urgentCollapsed, setUrgentCollapsed] = useState(false);
  const [bulkLoading, setBulkLoading] = useState<"confirm" | "pending" | null>(
    null,
  );

  useEffect(() => {
    dispatch(setTradies(initialTradies));
    dispatch(hydrateTradieCoordination(initialDashboard));
  }, [dispatch, initialDashboard, initialTradies]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      dispatch(setTradieFilters({ search: searchInput }));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [dispatch, searchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void dispatch(
        fetchTradieProjectLookup({
          page: 1,
          limit: tradiesState.projectLookup.limit,
          query: projectSearch,
        }),
      );
    }, 250);

    return () => window.clearTimeout(timer);
  }, [dispatch, projectSearch, tradiesState.projectLookup.limit]);

  useEffect(() => {
    void dispatch(fetchTradieCoordinationDashboard());
  }, [
    dispatch,
    tradiesState.filters.projectId,
    tradiesState.filters.search,
    tradiesState.filters.sortBy,
    tradiesState.filters.sortOrder,
    tradiesState.filters.status,
    tradiesState.filters.tab,
    tradiesState.filters.tradeType,
    tradiesState.pagination.limit,
    tradiesState.pagination.page,
  ]);

  const selectedProject = useMemo(() => {
    if (!tradiesState.filters.projectId) {
      return null;
    }

    const existing = tradiesState.projectLookup.items.find(
      (item) => item.id === tradiesState.filters.projectId,
    );
    if (existing) {
      return existing;
    }

    const fallback = tradiesState.schedules.find(
      (item) => item.projectId === tradiesState.filters.projectId,
    );
    if (!fallback) {
      return null;
    }

    return {
      id: fallback.projectId,
      name: fallback.projectName,
      description: "Current filter",
    };
  }, [
    tradiesState.filters.projectId,
    tradiesState.projectLookup.items,
    tradiesState.schedules,
  ]);

  const tableRowsSelected = tradiesState.schedules.filter((row) =>
    tradiesState.selectedScheduleIds.includes(row.id),
  );

  const pageItems = useMemo(() => {
    const total = tradiesState.pagination.totalPages;
    const current = tradiesState.pagination.page;

    if (total <= 7) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < total - 1) items.push("ellipsis");
    items.push(total);

    return items;
  }, [tradiesState.pagination.page, tradiesState.pagination.totalPages]);

  const updateScheduleStatuses = async (ids: string[], status: TradieScheduleStatus) => {
    if (ids.length === 0) return;

    await Promise.all(
      ids.map(async (id) =>
        dispatch(
          // dispatch individual update thunks to keep UI reactive
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore TODO: narrow thunk types when exporting AppDispatch
          updateTradieScheduleStatus({ scheduleId: id, status }),
        ).unwrap(),
      ),
    );

    dispatch(clearSelectedSchedules());
    // optionally refetch summary/dashboard to keep counts accurate
    void dispatch(fetchTradieCoordinationDashboard({ force: true }));
  };

  const handleBulkConfirm = async () => {
    setBulkLoading("confirm");
    await updateScheduleStatuses(
      tradiesState.selectedScheduleIds,
      TradieScheduleStatus.CONFIRMED,
    );
    setBulkLoading(null);
  };

  const handleBulkReminder = async () => {
    const valid = tableRowsSelected.filter(
      (row) =>
        row.status !== TradieScheduleStatus.CONFIRMED &&
        row.status !== TradieScheduleStatus.COMPLETED,
    );
    setBulkLoading("pending");
    await updateScheduleStatuses(
      valid.map((row) => row.id),
      TradieScheduleStatus.PENDING_RESPONSE,
    );
    setBulkLoading(null);
  };

  const handleRowQuickConfirm = async (row: TradieScheduleListItem) => {
    const loading = toast.loading("Updating status...");
    try {
      await updateScheduleStatuses([row.id], TradieScheduleStatus.CONFIRMED);
    } catch (error) {
      toast.error("Failed to update status. Please try again.");
      console.error("Error updating tradie schedule status:", error);
    } finally {
      toast.dismiss(loading);
    }
  };

  const handleUpdateRowStatus = (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "confirmStatus", payload: { schedule: row } }));
  };

  const handleViewScheduleDetails = (row: TradieUrgentReminderItem) => {
    dispatch(
      openModal({ type: "tradieScheduleDetails", payload: { schedule: row } }),
    );
  };

  const handleRowReminder = async (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "tradieReminder", payload: { schedule: row } }));
  };

  const handleRowCallLogged = async (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "logCall", payload: { schedule: row } }));
  };

  const exportCsv = () => {
    const headers = [
      "Tradie",
      "Trade",
      "Project",
      "Task",
      "Scheduled",
      "Duration",
      "Status",
    ];
    const rows = tradiesState.schedules.map((row) => [
      row.tradieName,
      row.tradeType,
      row.projectName,
      row.taskLabel,
      formatDate(row.scheduledDate),
      `${row.durationDays}`,
      statusLabelMap[row.status],
    ]);

    const csv = [headers, ...rows]
      .map((line) =>
        line
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tradie-coordination-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const scheduleTableHeaders = [
    <input
      key="select-all"
      type="checkbox"
      checked={
        tradiesState.schedules.length > 0 &&
        tradiesState.selectedScheduleIds.length ===
          tradiesState.schedules.length
      }
      onChange={(event) => {
        if (event.target.checked) {
          dispatch(
            setSelectedSchedules(tradiesState.schedules.map((row) => row.id)),
          );
        } else {
          dispatch(clearSelectedSchedules());
        }
      }}
    />,
    "Tradie",
    "Trade",
    "Project",
    "Task",
    "Scheduled",
    "Days Left",
    "Status",
    "Actions",
  ];

  const scheduleTableRows = tradiesState.schedules.map((row) => [
    <input
      key={`select-${row.id}`}
      type="checkbox"
      checked={tradiesState.selectedScheduleIds.includes(row.id)}
      onChange={() => dispatch(toggleScheduleSelection(row.id))}
      onClick={(event) => event.stopPropagation()}
    />,

    <div key={`tradie-${row.id}`}>
      <p className="font-semibold text-slate-900">{row.tradieName}</p>
      <p className="text-xs text-muted-foreground">
        {row.company ?? "Independent"}
      </p>
    </div>,

    row.tradeType,

    row.projectName,

    row.taskLabel,

    <div key={`schedule-${row.id}`}>
      <p className="font-medium">{formatDate(row.scheduledDate)}</p>
      <p className="text-xs text-muted-foreground">{row.durationDays} day(s)</p>
    </div>,

    <span
      key={`days-${row.id}`}
      className={[
        "rounded-md px-2 py-1 text-xs font-semibold flex gap-2 items-center",
        daysUntil(row.scheduledDate) <= 2
          ? "bg-red-100 text-red-700"
          : daysUntil(row.scheduledDate) <= 7
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {CalanderRow(row.scheduledDate)}
    </span>,

    <StatusPill key={`status-${row.id}`} tone={statusToneMap[row.status]}>
      {statusLabelMap[row.status]}
    </StatusPill>,

    <div
      key={`actions-${row.id}`}
      className="flex justify-start gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {(row.status === TradieScheduleStatus.PENDING ||
        row.status === TradieScheduleStatus.NO_RESPONSE ||
        row.status === TradieScheduleStatus.PENDING_RESPONSE) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleRowCallLogged(row)}
        >
          <Phone className="h-4 w-4" />
        </Button>
      )}

      {row.status !== TradieScheduleStatus.CONFIRMED &&
        row.status !== TradieScheduleStatus.COMPLETED && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleRowQuickConfirm(row)}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}

      {row.status !== TradieScheduleStatus.COMPLETED && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleRowReminder(row)}
        >
          <Mail className="h-4 w-4" />
        </Button>
      )}
      {row.status === TradieScheduleStatus.COMPLETED && (
        <Button size="sm" variant="ghost" disabled>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        disabled={row.status === TradieScheduleStatus.COMPLETED}
        onClick={() => void handleUpdateRowStatus(row)}
      >
        <EllipsisVertical className="h-4 w-4" />
      </Button>
    </div>,
  ]);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
        <CardContent className="relative p-6">
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Tradie Coordination Hub
              </h2>
              <p className="text-sm text-slate-600">
                Schedule tradies, track confirmations, and drive weekly site
                readiness.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => dispatch(openModal({ type: "scheduleTradie" }))}
              >
                <CalendarDays className="mr-2 size-4" />
                Schedule Tradie
              </Button>
              <Button
                variant="outline"
                onClick={() => dispatch(openModal({ type: "tradieDirectory" }))}
              >
                <Users className="mr-2 size-4" />
                Directory
              </Button>
              <Button variant="outline" onClick={exportCsv}>
                <Download className="mr-2 size-4" />
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {tradiesState.summary ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/70 bg-white/95">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="grid size-11 place-items-center rounded-xl bg-teal-600 text-white">
                  <Users className="size-5" />
                </div>
                <TrendBadge value={tradiesState.summary.registeredTrendDelta} />
              </div>
              <p className="text-3xl font-bold">
                {tradiesState.summary.registeredTradies}
              </p>
              <p className="text-xs text-muted-foreground">
                Registered Tradies
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-white/95">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="grid size-11 place-items-center rounded-xl bg-orange-500 text-white">
                  <CalendarDays className="size-5" />
                </div>
                <TrendBadge value={tradiesState.summary.scheduledWeekDelta} />
              </div>
              <p className="text-3xl font-bold">
                {tradiesState.summary.scheduledThisWeek}
              </p>
              <p className="text-xs text-muted-foreground">
                Scheduled This Week
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-white/95">
            <CardContent className="p-4">
              <div className="mb-3 grid size-11 place-items-center rounded-xl bg-emerald-600 text-white">
                <CheckCircle2 className="size-5" />
              </div>
              <p className="text-3xl font-bold">
                {tradiesState.summary.confirmedBookings}
              </p>
              <p className="text-xs text-muted-foreground">
                Confirmed Bookings
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-white/95">
            <CardContent className="p-4">
              <div className="mb-3 grid size-11 place-items-center rounded-xl bg-red-500 text-white">
                <AlertTriangle className="size-5" />
              </div>
              <p className="text-3xl font-bold">
                {tradiesState.summary.pendingNoResponse}
              </p>
              <p className="text-xs text-muted-foreground">
                Pending / No Response
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="border-border/70 bg-white/95 shadow-sm">
        <CardHeader className="border-b border-border/70 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">
              1-Week Advance Reminders
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUrgentCollapsed((prev) => !prev)}
            >
              {urgentCollapsed ? "Expand" : "Collapse"}
            </Button>
          </div>
        </CardHeader>
        {!urgentCollapsed ? (
          <CardContent className="space-y-2 pt-4">
            {tradiesState.urgentReminders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No urgent reminders. Upcoming jobs are currently healthy.
              </div>
            ) : (
              tradiesState.urgentReminders.map((item) => (
                <div
                  key={item.id}
                  className={[
                    "flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3",
                    item.daysLeft <= 2
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50",
                  ].join(" ")}
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {item.tradieName} · {item.projectName}
                    </p>
                    <p className="text-sm text-slate-600">
                      {item.tradeType} · {item.taskLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Scheduled {formatDate(item.scheduledDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={statusToneMap[item.status]}>
                      {statusLabelMap[item.status]}
                    </StatusPill>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleRowReminder({
                          id: item.id,
                          tradieId: "tradieId",
                          tradieName: item.tradieName,
                          tradeType: item.tradeType,
                          projectId: "item.projectId",
                          projectName: item.projectName,
                          milestoneId: "item.milestoneId",
                          milestoneName: item.milestoneName,
                          taskLabel: item.taskLabel,
                          scheduledDate: item.scheduledDate,
                          contact: item.contact,
                          siteManager: item.siteManager,
                          status: item.status,
                          reminderSentAt: item.reminderSentAt,
                          updatedAt: "item.updatedAt",
                          durationDays: 1,
                          company: item.company,
                        } satisfies TradieScheduleListItem)
                      }
                    >
                      <PhoneCall className="mr-1 size-3.5" />
                      Call
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewScheduleDetails(item)}
                    >
                      <Eye className="mr-1 size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        ) : null}
      </Card>

      <Card className="border-border/70 bg-white/95 shadow-sm">
        <CardHeader className="border-b border-border/70 px-5 py-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-4">
              {(
                [
                  "all",
                  "week",
                  "confirmed",
                  "pending",
                  "overdue",
                  "completed",
                ] as const
              ).map((tab) => {
                const active = tradiesState.filters.tab === tab;

                return (
                  <button
                    key={tab}
                    onClick={() => dispatch(setTradieFilters({ tab }))}
                    className={cn(
                      "group relative inline-flex h-9 items-center rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
                      active
                        ? "bg-teal-50 text-teal-700 shadow-sm"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span>
                      {tab === "all"
                        ? "All"
                        : tab === "week"
                          ? "Next 7 Days"
                          : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </span>

                    <span
                      className={cn(
                        "ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold transition-colors",
                        active
                          ? "bg-teal-600 text-white"
                          : "bg-muted text-muted-foreground group-hover:bg-background",
                      )}
                    >
                      {tradiesState.tabCounts[tab]}
                    </span>

                    {active && (
                      <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[280px] flex-1">
                <label htmlFor="search" className="sr-only">
                  Search
                </label>

                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  id="search"
                  className="h-10 rounded-lg border-border bg-background pl-9 text-[13px] shadow-none transition-all focus-visible:ring-4 focus-visible:ring-teal-500/10 focus-visible:border-teal-600"
                  placeholder="Search tradies, projects, trades..."
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>

              <div className="min-w-[180px] flex-1 lg:max-w-[220px]">
                <SearchableSelect
                  label=""
                  placeholder="All Projects"
                  searchValue={projectSearch}
                  selectedItem={selectedProject}
                  items={tradiesState.projectLookup.items}
                  loading={
                    tradiesState.projectLookup.loading ||
                    tradiesState.projectLookup.loadingMore
                  }
                  hasMore={
                    tradiesState.projectLookup.page <
                    tradiesState.projectLookup.totalPages
                  }
                  onQueryChange={setProjectSearch}
                  onSelect={(item) => {
                    dispatch(setTradieFilters({ projectId: item.id }));
                  }}
                  onLoadMore={() => {
                    void dispatch(
                      fetchTradieProjectLookup({
                        page: tradiesState.projectLookup.page + 1,
                        limit: tradiesState.projectLookup.limit,
                        query: projectSearch,
                      }),
                    );
                  }}
                />
              </div>

              <select
                className="h-10 min-w-[170px] rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground outline-none transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10"
                value={tradiesState.filters.tradeType ?? ""}
                onChange={(event) =>
                  dispatch(
                    setTradieFilters({
                      tradeType: event.target.value || null,
                    }),
                  )
                }
              >
                <option value="">All Trades</option>

                {tradiesState.tradeOptions.map((trade) => (
                  <option key={trade} value={trade}>
                    {trade}
                  </option>
                ))}
              </select>

              <select
                className="h-10 min-w-[170px] rounded-lg border border-border bg-background px-3 text-[12.5px] font-medium text-foreground outline-none transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-500/10"
                value={tradiesState.filters.status ?? ""}
                onChange={(event) =>
                  dispatch(
                    setTradieFilters({
                      status:
                        (event.target.value as TradieScheduleStatus) || null,
                    }),
                  )
                }
              >
                <option value="">All Statuses</option>

                {Object.entries(statusLabelMap).map(([status, label]) => (
                  <option key={status} value={status}>
                    {label}
                  </option>
                ))}
              </select>

              <p className="ml-auto whitespace-nowrap text-[12px] font-medium text-muted-foreground">
                {tradiesState.pagination.totalCount} results
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {tradiesState.loading ? <LoadingSkeleton /> : null}

          {!tradiesState.loading && tradiesState.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {tradiesState.error}
            </div>
          ) : null}

          {!tradiesState.loading &&
          !tradiesState.error &&
          tradiesState.schedules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No tradies match your current filters.
            </div>
          ) : null}

          {!tradiesState.loading &&
          !tradiesState.error &&
          tradiesState.schedules.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-border/70">
                <DataTable
                  headers={scheduleTableHeaders}
                  rows={scheduleTableRows}
                />
              </div>

              {tradiesState.selectedScheduleIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
                  <span className="text-sm font-semibold text-teal-700">
                    {tradiesState.selectedScheduleIds.length} selected
                  </span>
                  <Button
                    size="sm"
                    onClick={() => void handleBulkReminder()}
                    disabled={bulkLoading !== null}
                  >
                    {bulkLoading === "pending" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Send Reminders
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleBulkConfirm()}
                    disabled={bulkLoading !== null}
                  >
                    {bulkLoading === "confirm" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Mark Confirmed
                  </Button>
                </div>
              ) : null}

              {tradiesState.pagination.totalCount > 0 ? (
                <div className="space-y-2 pt-4">
                  <p className="text-center text-xs text-muted-foreground">
                    Showing {tradiesState.schedules.length} of{" "}
                    {tradiesState.pagination.totalCount} schedules
                  </p>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            dispatch(
                              setTradiePage(
                                Math.max(1, tradiesState.pagination.page - 1),
                              ),
                            );
                          }}
                          aria-disabled={tradiesState.pagination.page === 1}
                        />
                      </PaginationItem>
                      {pageItems.map((item, index) =>
                        item === "ellipsis" ? (
                          <PaginationItem key={`ellipsis-${index}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={item}>
                            <PaginationLink
                              href="#"
                              isActive={item === tradiesState.pagination.page}
                              onClick={(event) => {
                                event.preventDefault();
                                dispatch(setTradiePage(item));
                              }}
                            >
                              {item}
                            </PaginationLink>
                          </PaginationItem>
                        ),
                      )}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            dispatch(
                              setTradiePage(
                                Math.min(
                                  tradiesState.pagination.totalPages,
                                  tradiesState.pagination.page + 1,
                                ),
                              ),
                            );
                          }}
                          aria-disabled={
                            tradiesState.pagination.page >=
                            tradiesState.pagination.totalPages
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card className="border-border/70 bg-white/95 shadow-sm">
          <CardHeader className="border-b border-border/70 pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="relative pl-7 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border before:rounded-full">
              {tradiesState.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recent tradie activity found.
                </p>
              ) : (
                tradiesState.activity.map((entry) => (
                  <article key={entry.id} className="relative pb-5 last:pb-0">
                    <div
                      className={`absolute -left-[27.5px] top-1 size-[10px] rounded-full border-2 border-white ring-2 ring-offset-background z-10 ${entry.type === "done" ? "bg-green-600 ring-green-600" : entry.type === "warn" ? "bg-yellow-500 ring-yellow-500" : "bg-red-400 ring-red-400"}`}
                    />
                    <p className="mt-1 text-[13px] text-muted-foreground max-w-2xl">
                      {entry.message}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground font-medium">
                      {dataTimeFormat.format(new Date(entry.createdAt))}
                    </p>
                  </article>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <HorizontalBarChartCard
            title="Tradie Performance By Trade"
            subtitle="Confirmation rate across trades"
            data={tradiesState.tradeBreakdown}
            categoryKey="tradeType"
            valueKey="confirmedRate"
            valueLabel="Confirmation %"
            xAxisFormatter={(value) => `${value}%`}
            color="#0D9488"
          />

          <DonutChartCard
            title="Confirmation Status Breakdown"
            subtitle="Live status distribution"
            data={tradiesState.statusMetrics.filter((item) => item.value > 0)}
            labelKey="label"
            valueKey="value"
            colorByLabel={{
              Confirmed: "#16A34A",
              Pending: "#F59E0B",
              "Pending Response": "#2563EB",
              "No Response": "#DC2626",
              Declined: "#B91C1C",
              Completed: "#64748B",
            }}
          />
        </div>
      </div>
    </div>
  );
}
