"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserPlus,
  CircleCheckBig,
  Clock,
  CircleX,
  Mail,
  Plus,
  Table2,
  BarChart3,
  Search,
  Download,
  Sparkles,
  FileText,
} from "lucide-react";
import { fetchAllLeads } from "@/lib/leads/leads-service";
import { normalizeTypes } from "@/lib/leads/lead-helpers";
import { downloadWorkbook } from "@/lib/spreadsheet/download-workbook";
import { useLeadsData, type LeadListParams } from "@/hooks/use-leads-data";
import { useToast, ToastContainer } from "@/components/common/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { leadStatusSchema } from "@/utils/validators/lead";

import { AddLeadModal } from "@/components/leads/modal-ui/add-lead-modal";
import { EmailCampaignModal } from "@/components/leads/modal-ui/email-campaign-modal";
import { LeadMetricCard } from "@/components/common/lead-onclick-metric-card";
import { LeadPagination } from "./lead-pagination";
import {
  saveLeadsTableReturn,
  useLeadsTableReturn,
  type LeadsTableReturn,
} from "./leads-table-return";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LeadsContentSkeleton,
  LeadsPageSkeleton,
} from "@/components/leads/leads-page-skeleton";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams } from "next/navigation";
import TableView from "./views/table-view";
import { FollowupsView } from "./views";
import AnalyticsView from "./views/analytics-view";
import { useUser } from "@clerk/nextjs";

type TabType = "table" | "followups" | "analytics";

type TableFilters = {
  readonly query: string;
  readonly metric: string | null;
  readonly filterTiming: string;
};

/**
 * One request shape for the table, whoever asks: the filter effect, paging,
 * returning to the tab, and resuming where the table was (#350). Paging used
 * to build its own and dropped isArchived, so page 2 of the Archived chip
 * listed leads that were not archived.
 */
function tableListParams(filters: TableFilters, page: number): LeadListParams {
  const statusParam =
    filters.metric === "total" ? "total" : (filters.metric ?? undefined);
  return {
    page,
    limit: 10,
    query: filters.query.trim() || undefined,
    status:
      statusParam === "Archived"
        ? undefined
        : statusParam
            ?.split(",")
            .filter((s) => s && s !== "Archived")
            .join(",") || undefined,
    filterTiming: filters.filterTiming,
    isArchived: statusParam?.includes("Archived") ? true : undefined,
    // The "Open tasks" card is not a stage filter; see hasOpenTaskParam.
    hasOpenTask: filters.metric === "pendingFollowup" ? true : undefined,
  };
}

export default function Leads() {
  // Where the table was when this tab last left it (issue #350). Unknown until
  // the browser can be asked, so the table's filters are seeded once, from the
  // real answer, and the server never renders a different set.
  const resume = useLeadsTableReturn();
  if (resume === undefined) return <LeadsPageSkeleton />;
  return <LeadsWorkspace resume={resume} />;
}

function LeadsWorkspace({
  resume,
}: {
  readonly resume: LeadsTableReturn | null;
}) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("query");
  const initialStatus = searchParams.get("status");
  const { user, isLoaded } = useUser();
  // An explicit ?query= or ?status= link is a fresh request and wins over the
  // remembered position.
  const [resumeFrom] = useState(() =>
    initialQuery || initialStatus ? null : resume,
  );
  // Cleared as soon as the filters differ from the remembered ones: page 4 is
  // only page 4 of the list it was taken from.
  const resumeRef = useRef(resumeFrom);

  /* ── Hooks ── */
  const {
    leads,
    stats,
    analyticsData,
    pageInfo,
    loading,
    loadingLeads,
    error,
    loadData,
    refreshLeadsData,
    refreshStats,
    updateLeadInList,
    removeLeadFromList,
    prependLead,
    replaceLeads,
    appendEmailToLead,
  } = useLeadsData();

  const { toasts, showToast, dismissToast } = useToast();

  /* ── UI state ── */
  const [activeTab, setActiveTab] = useState<TabType>("table");
  const [searchTerm, setSearchTerm] = useState(resumeFrom?.query ?? "");
  const [activeMetric, setActiveMetric] = useState<string | null>(
    resumeFrom?.metric ?? null,
  );
  const [activeFilterTiming, setActiveFilterTiming] = useState(
    resumeFrom?.filterTiming ?? "all",
  );
  const [showAddLead, setShowAddLead] = useState(false);
  const [showEmailCampaign, setShowEmailCampaign] = useState(false);

  const debouncedSearch = useDebounce(searchTerm, 500);

  /* ── Derived ── */
  const conversionRate =
    stats && stats.total > 0
      ? ((stats.conversion / stats.total) * 100).toFixed(1)
      : "0.0";

  const statusParam =
    activeMetric === "total" ? "total" : (activeMetric ?? undefined);

  /**
   * The "Open tasks" card is not a stage filter.
   *
   * It means "leads carrying at least one open task", which no stage list can
   * express — resolveStatusFilter maps "pendingFollowup" to an empty array,
   * i.e. no filter at all. It was passed only by the click that set it, so the
   * search/filter effect immediately fired a second, unfiltered request for
   * the same click and normally landed last: the card said 14 and the table
   * showed every lead in the business. Paging then dropped it for good.
   * Derived from the active metric so it travels with every request.
   */
  const hasOpenTaskParam =
    activeMetric === "pendingFollowup" ? true : undefined;

  /* ── Search + filter effect ── */
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length > 4 || q.length === 0) {
      const filters = {
        query: q,
        metric: activeMetric,
        filterTiming: activeFilterTiming,
      };
      const resumed = resumeRef.current;
      const resuming =
        resumed !== null
        && resumed.query === q
        && resumed.metric === activeMetric
        && resumed.filterTiming === activeFilterTiming;
      if (!resuming) resumeRef.current = null;
      refreshLeadsData(tableListParams(filters, resuming ? resumed.page : 1));
    }
  }, [debouncedSearch, refreshLeadsData, activeMetric, activeFilterTiming]);

  /* ── Remember where the table is, for the way back from a lead ── */
  useEffect(() => {
    if (activeTab !== "table" || loading || loadingLeads) return;
    const q = debouncedSearch.trim();
    saveLeadsTableReturn({
      page: pageInfo.page,
      // Only a query the list was actually filtered by (the search waits for
      // five characters), so the way back shows the same rows.
      query: q.length > 4 ? q : "",
      metric: activeMetric,
      filterTiming: activeFilterTiming,
    });
  }, [
    activeTab,
    loading,
    loadingLeads,
    pageInfo.page,
    debouncedSearch,
    activeMetric,
    activeFilterTiming,
  ]);

  /* ── URL params on mount ── */
  useEffect(() => {
    if (initialQuery || initialStatus) {
      const decodedQuery = initialQuery
        ? decodeURIComponent(initialQuery)
        : null;
      const decodedStatus = initialStatus
        ? decodeURIComponent(initialStatus)
        : null;

      let validatedStatus: string | null = null;
      if (decodedStatus) {
        const knownKeywords = ["total", "converted", "pendingFollowup", "lost"];
        if (knownKeywords.includes(decodedStatus)) {
          validatedStatus = decodedStatus;
        } else {
          const parts = decodedStatus.split(",");
          const allValid = parts.every((part) => {
            const label = part.trim();
            // "Archived" is a chip but not a stage, and "Converted" is a stage
            // that was retired — a bookmarked ?status=Converted must keep
            // working rather than silently falling back to no filter.
            if (label === "Archived" || label === "Converted") return true;
            return leadStatusSchema.safeParse(label).success;
          });
          if (allValid) {
            validatedStatus = decodedStatus;
          }
        }
      }

      Promise.resolve().then(() => {
        const params: {
          status?: string;
          query?: string;
          hasOpenTask?: boolean;
        } = {};
        if (validatedStatus) {
          setActiveMetric(validatedStatus);
          params.status = validatedStatus;
          // Same rule as every other request: "pendingFollowup" is not a stage
          // and needs the open-task filter travelling with it. Without this a
          // bookmarked ?status=pendingFollowup loaded every lead first and
          // raced the filtered request the metric effect fires next.
          if (validatedStatus === "pendingFollowup") params.hasOpenTask = true;
        }
        if (decodedQuery && decodedQuery.trim().length > 0) {
          const query = decodedQuery.trim();
          setSearchTerm(query);
          params.query = query;
        }
        if (params.status || params.query) {
          loadData(params);
        }
      });
    } else {
      const resumed = resumeRef.current;
      loadData(resumed ? tableListParams(resumed, resumed.page) : {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialStatus]);

  /* ── Handlers ── */

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === "followups") {
      refreshLeadsData({ page: 1, limit: 50, hasOpenTask: true });
    } else if (tab === "table") {
      // With the filters still shown on the cards and search box, not an
      // unfiltered list under a highlighted card.
      refreshLeadsData(
        tableListParams(
          {
            // The same five-character rule the search effect applies.
            query: debouncedSearch.trim().length > 4 ? debouncedSearch : "",
            metric: activeMetric,
            filterTiming: activeFilterTiming,
          },
          1,
        ),
      );
    }
  };

  const handleMetricClick = (metric: string | null) => {
    setActiveTab("table");
    setActiveMetric(metric);
    const cleanedMetric =
      metric
        ?.split(",")
        .filter((s) => s && s !== "Archived")
        .join(",") || undefined;
    refreshLeadsData({
      page: 1,
      limit: 10,
      status:
        metric === "total" || metric === "Archived" ? "total" : cleanedMetric,
      filterTiming: activeFilterTiming,
      query: debouncedSearch.trim() || undefined,
      isArchived: metric?.includes("Archived") ? true : undefined,
      hasOpenTask: metric === "pendingFollowup" ? true : undefined,
    });
  };

  const handleFilterTimingChange = (filterTiming: string) => {
    setActiveFilterTiming(filterTiming);
    refreshLeadsData({
      page: 1,
      limit: 10,
      status: statusParam,
      filterTiming,
      query: debouncedSearch.trim() || undefined,
      hasOpenTask: hasOpenTaskParam,
    });
  };

  const handlePageChange = useCallback(
    async (page: number) => {
      await refreshLeadsData(
        tableListParams(
          {
            query: searchTerm,
            metric: activeMetric,
            filterTiming: activeFilterTiming,
          },
          page,
        ),
      );
    },
    [refreshLeadsData, searchTerm, activeMetric, activeFilterTiming],
  );

  const handleExport = async () => {
    const allLeads = await fetchAllLeads();
    const leadHeader = [
      "leadId",
      "name",
      "phone",
      "email",
      "location",
      "secondaryName",
      "secondaryEmail",
      "secondaryPhone",
      "SourceDetail",
      "Stage",
      "assigned",
      "budget",
      "notes",
      "FollowupsDate",
      "FollowupTime",
      "type",
      "lostReason",
      "urgent",
    ];
    const leadRows = allLeads.map((l) => {
      const types = normalizeTypes(l.type).filter((t) => t !== "Not Specified");
      return [
        l.id,
        l.name,
        l.phone,
        l.email,
        l.location,
        l.secondaryName || "",
        l.secondaryEmail || "",
        l.secondaryPhone || "",
        l.sourceDetail,
        l.stage,
        l.assignedUser?.name || "",
        l.budget,
        l.notes || "",
        l.followupDate || "",
        l.followupTime || "",
        types.join(", "),
        l.lostReason || "",
        l.urgent ? "true" : "false",
      ];
    });
    const historyHeader = ["leadId", "action", "detail", "type", "actionDate"];
    const historyRows = allLeads.flatMap((l) =>
      (l.history ?? []).map((e) => [
        l.id,
        e.action,
        e.detail,
        e.type,
        `${e.date} ${e.time}`.trim(),
      ]),
    );
    await downloadWorkbook(
      [
        { name: "Lead Data", rows: [leadHeader, ...leadRows] },
        { name: "History", rows: [historyHeader, ...historyRows] },
      ],
      `Royal_Constructions_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  /* ── Error state ── */
  if (error) {
    return (
      <div className="leads-error-container">
        <div className="leads-error-message">{error}</div>
        <button className="btn-primary-custom" onClick={() => loadData()}>
          Try Again
        </button>
      </div>
    );
  }

  if (!isLoaded) {
    return <LeadsPageSkeleton />;
  }

  /* ── Render ── */
  return (
    <div className="leads-container space-y-6">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Header card */}
      <Card className="overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
        <CardContent className="relative p-6">
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Lead Pipeline
              </h2>
              <p className="text-sm text-slate-600">
                Google Ads auto-capture • Follow-up automation • Email templates
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setShowEmailCampaign(true)}
              >
                <Mail className="mr-2 size-4" /> Email Campaign
              </Button>
              <Button onClick={() => setShowAddLead(true)}>
                <Plus className="mr-2 size-4" /> Add Lead Manually
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? <LeadsContentSkeleton /> : null}

      {/* Metric cards */}
      {stats && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-3">
            <LeadMetricCard
              label="Total Leads"
              value={String(stats.total)}
              note="All leads in the pipeline"
              tone="primary"
              icon={UserPlus}
              onClick={() => handleMetricClick("total")}
              active={activeMetric === "total"}
            />
            <LeadMetricCard
              label="New & Contacted"
              value={String((stats.new || 0) + (stats.contacted || 0))}
              note="Fresh and contacted leads"
              tone="info"
              icon={Sparkles}
              onClick={() => handleMetricClick("New,Contacted")}
              active={activeMetric === "New,Contacted"}
            />
            <LeadMetricCard
              label="Quoted"
              value={String(stats.quoted || 0)}
              note="Leads with active quotations"
              tone="badge"
              icon={FileText}
              onClick={() => handleMetricClick("Quoted")}
              active={activeMetric === "Quoted"}
            />
            <LeadMetricCard
              label={`Converted (${conversionRate}%)`}
              value={String(stats.conversion)}
              note="Won and converted leads"
              tone="success"
              icon={CircleCheckBig}
              onClick={() => handleMetricClick("converted")}
              active={activeMetric === "converted"}
            />
            <LeadMetricCard
              label="Open tasks"
              value={String(stats.pendingFollowup)}
              note="Calls, emails and meetings still open"
              tone="warning"
              icon={Clock}
              onClick={() => handleMetricClick("pendingFollowup")}
              active={activeMetric === "pendingFollowup"}
            />
            <LeadMetricCard
              label="Lost Leads"
              value={String(stats.lost)}
              note="Lost, cancelled or disqualified"
              tone="danger"
              icon={CircleX}
              onClick={() => handleMetricClick("lost")}
              active={activeMetric === "lost"}
            />
          </div>
        </>
      )}

      {/* Main card */}
      {loading ? null : (
        <Card className="border-border/70 bg-white/95 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-4 py-3 sm:px-5">
            {(
              [
                { key: "table" as TabType, label: "Leads", Icon: Table2 },
                { key: "followups" as TabType, label: "Tasks", Icon: Clock },
                {
                  key: "analytics" as TabType,
                  label: "Analytics",
                  Icon: BarChart3,
                },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={cn(
                  "group relative inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
                  activeTab === key
                    ? "bg-teal-50 text-teal-700 shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{label}</span>
                {activeTab === key && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                )}
              </button>
            ))}

            {!loading && activeTab === "table" && (
              <div className="flex w-full flex-wrap items-center gap-2 pt-2 sm:ml-auto sm:w-auto sm:gap-3 sm:pt-0">
                <Select
                  value={activeFilterTiming}
                  onValueChange={handleFilterTimingChange}
                >
                  <SelectTrigger className="h-9 flex-none rounded-full border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:ring-1 focus:ring-rc-gold">
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-40 rounded-md border border-gray-200 bg-white shadow-lg">
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="this_week">This Week</SelectItem>
                    <SelectItem value="this_month">This Month</SelectItem>
                    <SelectItem value="quarter">This Quarter</SelectItem>
                    <SelectItem value="this_year">This Year</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
                <div className="search-box min-w-0 flex-1">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Search leads..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button className="btn-export" onClick={handleExport}>
                  <Download size={14} />
                  Export
                </button>
              </div>
            )}
          </div>

          <CardContent className="pt-5">
            {activeTab === "table" && (
              <TableView
                loading={loadingLeads}
                leads={leads}
                onLeadUpdate={updateLeadInList}
                onLeadDelete={removeLeadFromList}
                activeMetric={activeMetric}
                onActiveMetricChange={handleMetricClick}
                user={{
                  clerkUserId: user?.id ?? null,
                  fullName: user?.fullName ?? null,
                }}
                appendEmailToLead={appendEmailToLead}
              />
            )}
            {activeTab === "followups" && (
              <FollowupsView
                loading={loadingLeads}
                leads={leads}
                onLeadUpdate={updateLeadInList}
                onLeadDelete={removeLeadFromList}
                showToast={showToast}
              />
            )}
            {activeTab === "analytics" && (
              <AnalyticsView analytics={analyticsData} />
            )}
            {activeTab !== "analytics" && (
              <LeadPagination
                leads={{
                  items: leads,
                  page: pageInfo.page,
                  limit: pageInfo.limit,
                  totalCount: pageInfo.total,
                  totalPages: pageInfo.totalPages,
                }}
                onPageChange={handlePageChange}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      {showAddLead && (
        <AddLeadModal
          onClose={() => setShowAddLead(false)}
          onSuccess={(lead) => {
            prependLead(lead);
            setShowAddLead(false);
          }}
          showToast={showToast}
        />
      )}

      {showEmailCampaign && (
        <EmailCampaignModal
          leads={leads}
          onClose={() => setShowEmailCampaign(false)}
          onCampaignComplete={async (updatedLeads) => {
            replaceLeads(updatedLeads);
            await refreshStats();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
