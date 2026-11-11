import { useState, useCallback, useEffect, useRef } from "react";
import { Lead, LeadStage, LeadsStats } from "@/lib/leads/types";
import { useAppSelector } from "@/lib/store/hooks";
import { LeadAnalyticsData } from "@/types/lead";
import { WIN_RATE_WINDOW_DAYS } from "@/lib/leads/pipeline-stages";
import { fetchLeads, fetchLeadsOverview } from "@/lib/leads/leads-service";
import type { LeadEmails } from "@prisma/client";
import type { LeadListSort } from "@/lib/leads/list-sort";

interface PageInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function resolveStatusFilter(status?: string): LeadStage[] | undefined {
  if (!status) return undefined;
  if (status === "total") return [];
  if (status === "converted") return ["Won", "Converted"];
  // Scheduled work is a task now, so this cohort is no longer expressible as
  // stages. The caller sends hasOpenTask instead; an empty list means "do not
  // filter by stage" rather than "match nothing".
  if (status === "pendingFollowup") return [];
  if (status === "lost") return ["Lost", "Cancelled", "Disqualified"];
  // "Archived" rides in the same comma list as the stage chips but is not a
  // stage — it drives the isArchived flag. Passing it through made the API
  // reject the whole filter, and before the API validated labels it silently
  // dropped it and returned every lead instead.
  return status
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "Archived") as LeadStage[];
}

export type LeadListParams = {
  sort?: LeadListSort;
  page?: number;
  limit?: number;
  query?: string;
  status?: string;
  filterTiming?: string;
  isArchived?: boolean;
  hasOpenTask?: boolean;
};

async function fetchLeadListPage(params: LeadListParams) {
  const request = {
    sort: params.sort,
    limit: params.limit ?? 10,
    q: params.query?.trim() || undefined,
    status: resolveStatusFilter(params.status),
    filterTiming: params.filterTiming,
    isArchived: params.isArchived,
    hasOpenTask: params.hasOpenTask,
  };
  const page = params.page ?? 1;
  const result = await fetchLeads({ ...request, page });
  // A remembered page can be past the end by the time it is asked for again
  // (issue #350: the list shrank while someone was on a lead). The server
  // answers that with an empty page, so step back to the last real one rather
  // than show "page 5" of four with no rows.
  if (
    result.items.length === 0
    && result.totalPages > 0
    && page > result.totalPages
  ) {
    return fetchLeads({ ...request, page: result.totalPages });
  }
  return result;
}

export function useLeadsData() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [analyticsData, setAnalyticsData] = useState<LeadAnalyticsData>({
    sourceData: [],
    conversionData: [],
    monthlyTrend: [],
    lostReasons: [],
    pipelineMetrics: {
      openCount: 0,
      valuedCount: 0,
      invalidValueCount: 0,
      totalValue: "0",
      weightedValue: "0",
      byStage: [],
      winRate: {
        percent: null,
        won: 0,
        lost: 0,
        windowDays: WIN_RATE_WINDOW_DAYS,
        estimatedDates: false,
      },
    },
    forecast: {
      fy: 0,
      quarter: 1,
      label: "",
      start: "",
      endExclusive: "",
      dealCount: 0,
      expectedValue: "0",
      weightedValue: "0",
      wonValue: "0",
      bankedValue: "0",
    },
  });
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Stats ── */
  // Guards against an older in-flight refresh landing after a newer one and
  // putting stale counts back on the cards. Task changes can arrive in quick
  // succession — closing several rows in a row — and the requests do not
  // necessarily resolve in the order they were issued.
  const statsRun = useRef(0);
  const refreshStats = useCallback(async () => {
    const run = ++statsRun.current;
    // No follow-up stats here any more. The Follow-ups tab derives its counts
    // from the task list it renders, so a second source could not agree with it.
    const { stats: statsData, analytics } = await fetchLeadsOverview();
    // A newer refresh started while this one was in flight; that one wins.
    if (run !== statsRun.current) return;
    setStats(statsData);
    setAnalyticsData(analytics);
  }, []);

  /**
   * Keep the six cards in step with the Tasks tab.
   *
   * "Open tasks" is the one card built from tasks rather than leads, and until
   * now only adding, editing or deleting a LEAD recalculated it. Closing five
   * tasks emptied five rows and left the card showing the old number until the
   * page was reloaded, which is precisely the sort of disagreement that makes
   * people stop trusting the numbers.
   */
  const tasksVersion = useAppSelector((state) => state.ui.leadTasksVersion);
  const seenTasksVersion = useRef(tasksVersion);
  useEffect(() => {
    // The first render already has fresh stats; only react to later changes.
    if (seenTasksVersion.current === tasksVersion) return;
    seenTasksVersion.current = tasksVersion;
    // Rejections here were unhandled. The cards simply keep their previous
    // values, which is the right outcome — a task list that reloaded fine
    // should not blank the page — but it must not surface as an unhandled
    // promise either.
    refreshStats().catch((err: unknown) => {
      console.error("Failed to refresh lead stats after a task change", err);
    });
  }, [tasksVersion, refreshStats]);

  /* ── Paginated leads ── */
  // Paging, filtering and typing each start a request, and they do not
  // necessarily resolve in the order they were issued: clicking page 2 then
  // page 3 could leave page 2's rows under a URL that says 3. Only the latest
  // request, from either loader below, may touch the table.
  const leadsRun = useRef(0);

  /**
   * Resolves to the page actually shown — which is not the one asked for when
   * a remembered page was past the end — or null when a newer request took
   * over and this one's answer was dropped.
   */
  const refreshLeadsData = useCallback(
    async (params: LeadListParams): Promise<number | null> => {
      const run = ++leadsRun.current;
      try {
        setLoadingLeads(true);
        const leadsData = await fetchLeadListPage(params);
        if (run !== leadsRun.current) return null;
        setLeads(leadsData.items);
        setPageInfo({
          page: leadsData.page,
          limit: leadsData.limit,
          total: leadsData.totalCount,
          totalPages: leadsData.totalPages,
        });
        return leadsData.page;
      } catch (err) {
        if (run !== leadsRun.current) return null;
        console.error(err);
        setError("Failed to refresh leads data");
        return null;
      } finally {
        if (run === leadsRun.current) setLoadingLeads(false);
      }
    },
    [],
  );

  /* ── Full load (initial / hard refresh) ── */
  const loadData = useCallback(
    async (params: LeadListParams = {}): Promise<number | null> => {
      const run = ++leadsRun.current;
      try {
        setLoading(true);
        // Settled separately: a newer table request supersedes only this
        // one's rows, so the cards must neither wait on nor be swallowed by
        // the table's fate.
        const [leadsResult, overviewResult] = await Promise.allSettled([
          // "pendingFollowup" is not a stage — resolveStatusFilter maps it to
          // an empty array — so without hasOpenTask the initial load for a
          // bookmarked ?status=pendingFollowup fetched every lead and raced
          // the filtered request the metric effect fires straight after.
          fetchLeadListPage(params),
          // The cards and the analytics in one Server Action: two were
          // dispatched one after the other.
          fetchLeadsOverview(),
        ]);
        if (overviewResult.status === "fulfilled") {
          setStats(overviewResult.value.stats);
          setAnalyticsData(overviewResult.value.analytics);
        }
        const cardFailures =
          overviewResult.status === "rejected" ? [overviewResult.reason] : [];
        if (cardFailures.length > 0) {
          console.error(...cardFailures);
          setError("Failed to load leads data");
        }
        if (run !== leadsRun.current) return null;
        if (leadsResult.status === "rejected") {
          console.error(leadsResult.reason);
          setError("Failed to load leads data");
          return null;
        }
        const leadsData = leadsResult.value;
        setLeads(leadsData.items);
        setPageInfo({
          page: leadsData.page,
          limit: leadsData.limit,
          total: leadsData.totalCount,
          totalPages: leadsData.totalPages,
        });
        if (cardFailures.length === 0) setError(null);
        return leadsData.page;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /* ── Mutations ── */
  const updateLeadInList = useCallback(
    async (updatedLead: Lead): Promise<boolean> => {
      if (!updatedLead) return false;
      setLeads((prev) =>
        prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)),
      );
      await refreshStats();
      return true;
    },
    [refreshStats],
  );

  const removeLeadFromList = useCallback(
    async (leadId: number) => {
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
      await refreshStats();
    },
    [refreshStats],
  );

  const prependLead = useCallback(
    async (newLead: Lead) => {
      setLeads((prev) => [newLead, ...prev]);
      await refreshStats();
    },
    [refreshStats],
  );

  const replaceLeads = useCallback((next: Lead[]) => {
    setLeads(next);
  }, []);

  const appendEmailToLead = useCallback(
    (leadId: number, newEmail: LeadEmails) => {
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                emails: [newEmail, ...lead.emails],
              }
            : lead,
        ),
      );
    },
    [],
  );

  return {
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
  };
}
