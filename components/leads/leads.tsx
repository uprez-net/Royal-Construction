"use client";

import React, { useState, useEffect, useCallback } from "react";
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
import { useLeadsData } from "@/hooks/use-leads-data";
import { useToast, ToastContainer } from "@/components/common/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { leadStatusSchema } from "@/utils/validators/lead";

import { AddLeadModal } from "@/components/leads/modal-ui/add-lead-modal";
import { EmailCampaignModal } from "@/components/leads/modal-ui/email-campaign-modal";
import { LeadMetricCard } from "@/components/common/lead-onclick-metric-card";
import { LeadPagination } from "./lead-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import FollowupsView from "./views/followups-view";
import AnalyticsView from "./views/analytics-view";
import { useUser } from "@clerk/nextjs";

type TabType = "table" | "followups" | "analytics";

export default function Leads() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("query");
  const initialStatus = searchParams.get("status");
  const { user, isLoaded } = useUser();

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
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [activeFilterTiming, setActiveFilterTiming] = useState("all");
  const [showAddLead, setShowAddLead] = useState(false);
  const [showEmailCampaign, setShowEmailCampaign] = useState(false);

  const debouncedSearch = useDebounce(searchTerm, 500);

  /* ── Derived ── */
  const conversionRate =
    stats && stats.total > 0
      ? ((stats.conversion / stats.total) * 100).toFixed(1)
      : "0.0";

  const statusParam = activeMetric === "total" ? "total" : activeMetric ?? undefined;

  /* ── Search + filter effect ── */
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length > 4 || q.length === 0) {
      refreshLeadsData({
        page: 1,
        limit: 10,
        query: q || undefined,
        status: statusParam,
        filterTiming: activeFilterTiming,
      });
    }
  }, [debouncedSearch, refreshLeadsData, statusParam, activeFilterTiming]);

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
          const allValid = parts.every(part => leadStatusSchema.safeParse(part.trim()).success);
          if (allValid) {
            validatedStatus = decodedStatus;
          }
        }
      }

      Promise.resolve().then(() => {
        const params: { status?: string; query?: string } = {};
        if (validatedStatus) {
          setActiveMetric(validatedStatus);
          params.status = validatedStatus;
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
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialStatus]);

  /* ── Handlers ── */

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === "followups") {
      refreshLeadsData({
        page: 1,
        limit: 50,
        status: [
          "New",
          "Contacted",
          "Qualified",
          "Quoted",
          "Negotiating",
          "Meeting Scheduled",
          "In Follow-up",
          "No Response",
        ].join(","),
      });
    } else if (tab === "table") {
      refreshLeadsData({ page: 1, limit: 10 });
    }
  };

  const handleMetricClick = (metric: string | null) => {
    setActiveMetric(metric);
    refreshLeadsData({
      page: 1,
      limit: 10,
      status: metric === "total" ? "total" : metric ?? undefined,
      filterTiming: activeFilterTiming,
      query: debouncedSearch.trim() || undefined,
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
    });
  };

  const handlePageChange = useCallback(
    async (page: number) => {
      await refreshLeadsData({
        page,
        limit: pageInfo.limit,
        query: searchTerm,
        status: statusParam,
        filterTiming: activeFilterTiming,
      });
    },
    [refreshLeadsData, statusParam, pageInfo.limit, searchTerm, activeFilterTiming],
  );

  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const allLeads = await fetchAllLeads();
    const leadHeader = [
      "leadId",
      "name",
      "phone",
      "email",
      "location",
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
      const types = normalizeTypes(l.type).filter(
        (t) => t !== "Not Specified",
      );
      return [
        l.id,
        l.name,
        l.phone,
        l.email,
        l.location,
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
    const historyHeader = [
      "leadId",
      "action",
      "detail",
      "type",
      "actionDate",
    ];
    const historyRows = allLeads.flatMap((l) =>
      (l.history ?? []).map((e) => [
        l.id,
        e.action,
        e.detail,
        e.type,
        `${e.date} ${e.time}`.trim(),
      ]),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([leadHeader, ...leadRows]),
      "Lead Data",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([historyHeader, ...historyRows]),
      "History",
    );
    XLSX.writeFile(
      wb,
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

  if (isLoaded && !leads) {
    return (
      <div className="leads-loading-container">
        <div className="leads-loading-message">Loading leads...</div>
      </div>
    );
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

      {/* Metric cards */}
      {stats && !loading && (
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
            label="Pending Follow-up"
            value={String(stats.pendingFollowup)}
            note="Leads awaiting next action"
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
      )}

      {/* Main card */}
      <Card className="border-border/70 bg-white/95 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-4 py-3 sm:px-5">
          {(
            [
              { key: "table" as TabType, label: "Table View", Icon: Table2 },
              { key: "followups" as TabType, label: "Follow-ups", Icon: Clock },
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

          {!loading && (
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
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-teal-600" />
              <p className="text-sm">Loading leads...</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </CardContent>
      </Card>

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
