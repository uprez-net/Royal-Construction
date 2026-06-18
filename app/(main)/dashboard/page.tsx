import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { auth } from "@clerk/nextjs/server";
import { getProjects, type PaginatedProjectsResult } from "@/lib/data/projects";
import {
  getDashboardFollowUps,
  getDashboardGraphData,
  getDashboardKPIData,
  type DashboardGraphData,
} from "@/lib/data/dashboard";
import { connection } from "next/server";
import type { DashboardKPI } from "@/types/dashboard";
import type { FollowUpItem } from "@/components/dashboard/dashboard-follow-ups";
import type { Metadata } from "next";

const emptyDashboardKPI: DashboardKPI = {
  followUpsCount: 0,
  newProjectsCount: 0,
  newLeadsThisMonth: { total: 0, trendDelta: 0 },
  newLeadsConvertedThisMonth: { total: 0, trendDelta: 0 },
  revenueThisQuarter: { total: 0, trendDelta: 0 },
  netProfitThisQuarter: { total: 0, trendDelta: 0 },
  activeProjects: { total: 0, trendDelta: 0 },
  activeSiteManagers: { total: 0, trendDelta: 0 },
  estimateProjectSpendingThisQuarter: { total: 0, trendDelta: 0 },
  actualProjectSpendingThisQuarter: { total: 0, trendDelta: 0 },
};

const emptyProjects: PaginatedProjectsResult = {
  items: [],
  page: 1,
  limit: 10,
  totalCount: 0,
  totalPages: 0,
};

const emptyGraphData: DashboardGraphData = {
  nonConversionData: [],
  leadAndRevenueData: [],
  conversionBreakdownData: [],
  estVsSpendProjectData: [],
};

async function settleDashboardSection<T>(
  label: string,
  action: Promise<T>,
  fallback: T,
) {
  try {
    return { data: await action, warning: null };
  } catch (error) {
    console.error(`Dashboard ${label} failed:`, error);
    return { data: fallback, warning: label };
  }
}

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Overviews and insights into your construction projects, KPIs, and follow-ups.",
};

export default async function DashboardPageClient() {
  await connection();
  const [user, projectsResult, kpiResult, followUpsResult, graphResult] = await Promise.all([
    auth(),
    settleDashboardSection(
      "project list",
      getProjects({
        page: 1,
        limit: 10,
        status: "ACTIVE",
      }),
      emptyProjects,
    ),
    settleDashboardSection("KPI data", getDashboardKPIData(), emptyDashboardKPI),
    settleDashboardSection<FollowUpItem[]>(
      "follow-up list",
      getDashboardFollowUps(),
      [],
    ),
    settleDashboardSection("graph data", getDashboardGraphData(), emptyGraphData),
  ]);

  const dashboardKPI = kpiResult.data;
  const followUpItems = followUpsResult.data;
  const warnings = [
    projectsResult.warning,
    kpiResult.warning,
    followUpsResult.warning,
    graphResult.warning,
  ].filter((warning): warning is string => warning !== null);

  return (
    <DashboardHome
      userFirstName={user.sessionClaims?.firstName ?? "User"}
      graphData={graphResult.data}
      projectsData={projectsResult.data}
      kpiData={dashboardKPI}
      newLeadsCount={dashboardKPI.newLeadsThisMonth.total}
      newProjectsCount={dashboardKPI.newProjectsCount}
      followUpsCount={dashboardKPI.followUpsCount}
      followUpItems={followUpItems}
      dataWarnings={warnings}
     />
  );
}
