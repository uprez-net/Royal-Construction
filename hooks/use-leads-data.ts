import { useState, useCallback } from "react";
import { Lead, LeadStage, LeadsStats } from "@/lib/leads/types";
import { LeadAnalyticsData } from "@/types/lead";
import {
  fetchLeads,
  fetchLeadsStats,
  fetchLeadAnalyticsData,
} from "@/lib/leads/leads-service";

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
  if (status === "pendingFollowup") return ["In Follow-up"];
  if (status === "lost") return ["Lost", "Cancelled", "Disqualified"];
  return status.split(",") as LeadStage[];
}

export function useLeadsData() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [analyticsData, setAnalyticsData] = useState<LeadAnalyticsData>({
    sourceData: [],
    conversionData: [],
    monthlyTrend: [],
    lostReasons: [],
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
  const refreshStats = useCallback(async () => {
    const [statsData, analytics] = await Promise.all([
      fetchLeadsStats(),
      fetchLeadAnalyticsData(),
    ]);
    setStats(statsData);
    setAnalyticsData(analytics);
  }, []);

  /* ── Paginated leads ── */
  const refreshLeadsData = useCallback(
    async (params: {
      page?: number;
      limit?: number;
      query?: string;
      status?: string;
      filterTiming?: string;
    }) => {
      try {
        setLoadingLeads(true);
        const leadsData = await fetchLeads({
          page: params.page ?? 1,
          limit: params.limit ?? 10,
          q: params.query?.trim() || undefined,
          status: resolveStatusFilter(params.status),
          filterTiming: params.filterTiming,
        });
        setLeads(leadsData.items);
        setPageInfo({
          page: leadsData.page,
          limit: leadsData.limit,
          total: leadsData.totalCount,
          totalPages: leadsData.totalPages,
        });
      } catch (err) {
        console.error(err);
        setError("Failed to refresh leads data");
      } finally {
        setLoadingLeads(false);
      }
    },
    [],
  );

  /* ── Full load (initial / hard refresh) ── */
  const loadData = useCallback(
    async (params: { query?: string; status?: string } = {}) => {
      try {
        setLoading(true);
        const [leadsData, statsData, analytics] = await Promise.all([
          fetchLeads({
            page: 1,
            limit: 10,
            q: params.query?.trim() || undefined,
            status: resolveStatusFilter(params.status),
          }),
          fetchLeadsStats(),
          fetchLeadAnalyticsData(),
        ]);
        setLeads(leadsData.items);
        setPageInfo({
          page: leadsData.page,
          limit: leadsData.limit,
          total: leadsData.totalCount,
          totalPages: leadsData.totalPages,
        });
        setStats(statsData);
        setAnalyticsData(analytics);
        setError(null);
      } catch (err) {
        setError("Failed to load leads data");
        console.error(err);
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
  };
}