"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useTransition,
} from "react";
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

import { AddLeadModal } from "@/components/leads/modal-ui/add-lead-modal";
import { EmailCampaignModal } from "@/components/leads/modal-ui/email-campaign-modal";
import { UnmatchedWhatsAppButton } from "@/components/leads/whatsapp/unmatched-whatsapp-review";
import { LeadMetricCard } from "@/components/common/lead-onclick-metric-card";
import { MOBILE_METRIC_STRIP_CLASS } from "@/components/common/metric-card";
import { LeadPagination } from "./lead-pagination";
import { reloadLeadList, updateAndRefreshLeadList } from "./leads-list-refresh";
import {
  readLeadsListParams,
  LEAD_SORT_OPTIONS,
  MIN_SEARCH_CHARS,
  searchHeading,
  searchQueryToRequest,
  withLeadsListParams,
  type LeadsListParamChanges,
} from "./leads-list-url";
import { nextTabIndex } from "@/lib/a11y/tab-keys";
import { Card, CardContent } from "@/components/ui/card";
import { ListSortMenu } from "@/components/common/list-sort-menu";
import type { LeadListSort } from "@/lib/leads/list-sort";
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TableView from "./views/table-view";
import { FollowupsView } from "./views";
import AnalyticsView from "./views/analytics-view";
import { useUser } from "@clerk/nextjs";

type TabType = "table" | "followups" | "analytics";

// The page's three views. A tab strip, so the active one has to be exposed
// (aria-selected) and arrow keys move between them (#442).
const VIEW_TABS = [
  { key: "table" as TabType, label: "Leads", Icon: Table2 },
  { key: "followups" as TabType, label: "Tasks", Icon: Clock },
  { key: "analytics" as TabType, label: "Analytics", Icon: BarChart3 },
] as const;
const VIEW_PANEL_ID = "leads-view-panel";
const viewTabId = (key: TabType) => `leads-view-tab-${key}`;

type TableFilters = {
  readonly sort: LeadListSort;
  readonly query: string;
  readonly metric: string | null;
  readonly filterTiming: string;
};

/**
 * One request shape for the table, whoever asks: the first load, paging,
 * filtering and the refresh when the page is shown again. Paging used to build
 * its own and dropped isArchived, so page 2 of the Archived chip listed leads
 * that were not archived.
 */
function tableListParams(filters: TableFilters, page: number): LeadListParams {
  const statusParam =
    filters.metric === "total" ? "total" : (filters.metric ?? undefined);
  return {
    sort: filters.sort,
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
    // The "Open tasks" card is not a stage filter: it means "leads carrying at
    // least one open task", which no stage list can express (resolveStatusFilter
    // maps "pendingFollowup" to no stage filter at all). It has to travel with
    // every request, or the card said 14 and the table showed every lead.
    hasOpenTask: filters.metric === "pendingFollowup" ? true : undefined,
  };
}

/** Render a fresh lead workspace for each navigation while retaining browser-back state. */
export default function Leads() {
  // A fresh visit — the sidebar, "Back to all leads", any link — gets a fresh
  // table (tab, search box). Browser back/forward keeps the one Next preserved
  // for the hidden page, and paging or filtering only changes search params,
  // which keep this key. The table's place itself is in the URL.
  const { bfcacheId } = useRouter();
  return <LeadsWorkspace key={bfcacheId} />;
}

/** Coordinate lead tabs, URL filters, paging and mutation-driven refreshes. */
function LeadsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The table's place lives in the URL (#350): ?page=, ?query=, ?status= and
  // ?timing=. Coming back to /leads?page=4 from a lead lands on page 4, a
  // reload keeps it, and opening Leads fresh from anywhere else starts over.
  const list = readLeadsListParams(searchParams);
  const page = list.page;
  const urlQuery = list.query;
  const activeMetric = list.status;
  const activeFilterTiming = list.timing;
  const activeSort = list.sort;
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
    replaceLeads,
    appendEmailToLead,
  } = useLeadsData();

  const { toasts, showToast, dismissToast } = useToast();

  /* ── UI state ── */
  const [activeTab, setActiveTab] = useState<TabType>("table");
  const [searchTerm, setSearchTerm] = useState(urlQuery);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showEmailCampaign, setShowEmailCampaign] = useState(false);

  const debouncedSearch = useDebounce(searchTerm, 500);
  const typedSearch = searchTerm.trim();
  // A query already applied from the URL is kept as it is (see the effect
  // below), so it is not "too short" however short it is.
  const searchTooShort =
    typedSearch.length > 0
    && typedSearch.length < MIN_SEARCH_CHARS
    && typedSearch !== urlQuery;

  /* ── Derived ── */
  const conversionRate =
    stats && stats.total > 0
      ? ((stats.conversion / stats.total) * 100).toFixed(1)
      : "0.0";

  const tableParams = tableListParams(
    {
      query: urlQuery,
      metric: activeMetric,
      filterTiming: activeFilterTiming,
      sort: activeSort,
    },
    page,
  );

  /* ── URL updates ── */
  // replace, not push: a page or filter change is not a step the back button
  // should walk through; the entry that matters is the one a lead was opened
  // from, which is whatever the URL says at that moment.
  //
  // Every change to the list's URL goes through here, so counting the calls
  // says whether a request is still the latest one (see the search effect).
  const navigationCountRef = useRef(0);
  const updateListParams = useCallback(
    (changes: LeadsListParamChanges) => {
      navigationCountRef.current += 1;
      router.replace(
        `${pathname}${withLeadsListParams(searchParams, changes)}`,
        {
          scroll: false,
        },
      );
    },
    [pathname, router, searchParams],
  );

  /* ── Search box → ?query= ── */
  // router.replace takes a round trip, and urlQuery only catches up when it
  // lands. Marking the request as a transition says when it is still in flight,
  // and the ref remembers what it asked for, so a clear made before the URL
  // caught up is judged against that and not against the stale URL (#465).
  //
  // It only counts while it is still the latest navigation. A metric card, page
  // or sort change made meanwhile preempts it (Next drops the older one), and
  // judging a clear against a query that was dropped would send a replace built
  // from stale params that wipes the card's filter.
  const [searchNavigating, startSearchNavigation] = useTransition();
  const requestedQueryRef = useRef<string | null>(null);
  const requestedNavigationRef = useRef(-1);
  // Browser Back or Forward (#484) is not counted above, and it takes the URL
  // to a query the box must follow. The box is set to that query when Back
  // arrives (the pending debounce is cancelled with it), and the query is the
  // heading until the URL lands, so the search does not re-apply the one Back
  // just left.
  const historyQueryRef = useRef<string | null>(null);
  useEffect(() => {
    historyQueryRef.current = null;
  }, [urlQuery]);
  useEffect(() => {
    const onHistoryNavigation = () => {
      const target = readLeadsListParams(
        new URLSearchParams(window.location.search),
      ).query;
      // Back supersedes a search request still in flight.
      requestedQueryRef.current = null;
      if (target === urlQuery) return;
      historyQueryRef.current = target;
      setSearchTerm(target);
    };
    window.addEventListener("popstate", onHistoryNavigation);
    return () => window.removeEventListener("popstate", onHistoryNavigation);
  }, [urlQuery]);
  useEffect(() => {
    const heading = searchHeading({
      navigating: searchNavigating,
      requestedNavigation: requestedNavigationRef.current,
      latestNavigation: navigationCountRef.current,
      requested: requestedQueryRef.current,
      shown: urlQuery,
      history: historyQueryRef.current,
    });
    const next = searchQueryToRequest(debouncedSearch.trim(), heading);
    if (next === null) return;
    requestedQueryRef.current = next;
    startSearchNavigation(() => {
      updateListParams({ query: next, page: null });
      requestedNavigationRef.current = navigationCountRef.current;
    });
    // Only the person's typing drives this; the URL changing under it (a
    // metric card, paging) must not write the box back over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  /* ── Load what the URL and tab describe ── */
  // A remembered page past the end is answered with the last real one; put
  // that in the URL too, or the link a lead is opened from, and a reload,
  // would carry a page the table is not on. A loader resolves to null when a
  // newer request superseded it, and that one settles the URL instead.
  const settleTablePage = (shown: number | null) => {
    if (shown === null || shown === page) return;
    updateListParams({ page: shown > 1 ? String(shown) : null });
  };

  // Async edit callbacks can outlive the tab or filters they were rendered for.
  // Read the latest committed view only after their stats refresh has settled.
  const currentListView = useRef({ activeTab, tableParams, settleTablePage });
  useLayoutEffect(() => {
    currentListView.current = { activeTab, tableParams, settleTablePage };
  });

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current) {
      // The first load brings the cards and analytics with it.
      loadedRef.current = true;
      loadData(tableParams).then(settleTablePage);
      return;
    }
    // With cacheComponents, Next hides /leads while a lead is open and re-runs
    // this effect when it is shown again; the URL still names the same page,
    // so this refreshes it rather than starting over.
    if (activeTab === "followups") {
      refreshLeadsData({ page: 1, limit: 50, hasOpenTask: true });
    } else if (activeTab === "table") {
      refreshLeadsData(tableParams).then(settleTablePage);
    }
    // tableParams is rebuilt every render; these are what it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, page, urlQuery, activeMetric, activeFilterTiming, activeSort]);

  // The cards, when the page is shown again after a lead (a stage changed
  // there should show up). The first load already fetched them.
  const shownRef = useRef(false);
  useEffect(() => {
    if (!shownRef.current) {
      shownRef.current = true;
      return;
    }
    refreshStats().catch((err: unknown) => {
      console.error("Failed to refresh lead stats on return", err);
    });
  }, [refreshStats]);

  /* ── Handlers ── */

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  // Arrow/Home/End move focus and select, as the other tab strips do. Roving
  // tabindex below keeps the strip a single Tab stop.
  const viewTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleViewTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = nextTabIndex(event.key, index, VIEW_TABS.length);
    if (next === null) return;
    event.preventDefault();
    handleTabChange(VIEW_TABS[next].key);
    viewTabRefs.current[next]?.focus();
  };

  const handleMetricClick = (metric: string | null) => {
    setActiveTab("table");
    updateListParams({ status: metric, page: null });
  };

  const handleFilterTimingChange = (filterTiming: string) => {
    updateListParams({
      timing: filterTiming === "all" ? null : filterTiming,
      page: null,
    });
  };

  const handlePageChange = useCallback(
    (nextPage: number) => {
      updateListParams({ page: nextPage > 1 ? String(nextPage) : null });
    },
    [updateListParams],
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
        <button
          className="btn-primary-custom"
          onClick={() => loadData(tableParams).then(settleTablePage)}
        >
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
        <CardContent className="relative p-4 sm:p-6">
          <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
          <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-slate-900">
                Lead Pipeline
              </h1>
              <p className="hidden text-sm text-slate-600 sm:block">
                Google Ads auto-capture • Follow-up automation • Email templates
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <UnmatchedWhatsAppButton />
              <Button
                variant="outline"
                onClick={() => setShowEmailCampaign(true)}
              >
                <Mail className="mr-2 size-4" />
                <span className="sm:hidden">Email</span>
                <span className="hidden sm:inline">Email Campaign</span>
              </Button>
              <Button onClick={() => setShowAddLead(true)}>
                <Plus className="mr-2 size-4" />
                <span className="sm:hidden">Add Lead</span>
                <span className="hidden sm:inline">Add Lead Manually</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? <LeadsContentSkeleton /> : null}

      {/* Metric cards */}
      {stats && !loading && (
        <>
          {/* Six cards stacked three rows deep pushed the list itself below
              the fold on a phone; there they scroll sideways instead. */}
          <div
            className={cn(
              MOBILE_METRIC_STRIP_CLASS,
              "sm:grid-cols-2 md:grid-cols-3",
            )}
          >
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
            <div
              role="tablist"
              aria-label="Leads views"
              className="flex flex-wrap items-center gap-1.5"
            >
              {VIEW_TABS.map(({ key, label, Icon }, index) => (
                <button
                  key={key}
                  ref={(node) => {
                    viewTabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={viewTabId(key)}
                  aria-selected={activeTab === key}
                  aria-controls={VIEW_PANEL_ID}
                  tabIndex={activeTab === key ? 0 : -1}
                  onClick={() => handleTabChange(key)}
                  onKeyDown={(event) => handleViewTabKeyDown(event, index)}
                  className={cn(
                    "group relative inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors duration-200 sm:min-h-9 sm:text-[12.5px]",
                    activeTab === key
                      ? "bg-teal-50 text-teal-700 shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{label}</span>
                  {activeTab === key && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                  )}
                </button>
              ))}
            </div>

            {!loading && activeTab === "table" && (
              <div className="flex w-full flex-wrap items-center gap-2 pt-2 sm:ml-auto sm:w-auto sm:gap-3 sm:pt-0">
                <ListSortMenu
                  label="leads"
                  value={activeSort}
                  options={LEAD_SORT_OPTIONS}
                  onChange={(sort) => updateListParams({ sort, page: null })}
                />
                <Select
                  value={activeFilterTiming}
                  onValueChange={handleFilterTimingChange}
                >
                  <SelectTrigger
                    aria-label="Filter by timeframe"
                    className="h-9 flex-1 rounded-full sm:flex-none border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:ring-1 focus:ring-rc-gold"
                  >
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
                    aria-label="Search leads"
                    type="text"
                    placeholder="Search leads..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-describedby={
                      searchTooShort ? "leads-search-hint" : undefined
                    }
                  />
                  {/* Always mounted so the live region is registered before
                      its text changes. Drawn inside the input's right edge, so
                      it moves nothing and cannot cover the row below on a
                      phone. */}
                  <p
                    id="leads-search-hint"
                    role="status"
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground"
                  >
                    {searchTooShort
                      ? `Type ${MIN_SEARCH_CHARS}+ characters`
                      : ""}
                  </p>
                </div>
                <button className="btn-export" onClick={handleExport}>
                  <Download size={14} />
                  Export
                </button>
              </div>
            )}
          </div>

          <CardContent
            role="tabpanel"
            id={VIEW_PANEL_ID}
            aria-labelledby={viewTabId(activeTab)}
            className="pt-5"
          >
            {activeTab === "table" && (
              <TableView
                loading={loadingLeads}
                leads={leads}
                onLeadUpdate={(lead) =>
                  updateAndRefreshLeadList(
                    () => updateLeadInList(lead),
                    () => currentListView.current,
                    refreshLeadsData,
                  )
                }
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
            {/* The table's pages only. The Tasks tab lists tasks, not this
                page of leads, so paging there changed nothing on screen. */}
            {activeTab === "table" && (
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
          onSuccess={() => {
            void reloadLeadList(currentListView.current, loadData);
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
