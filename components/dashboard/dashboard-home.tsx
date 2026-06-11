import { DashboardHeader } from "./dashboard-header";
import { DashboardKPI } from "./dashboard-kpi";
import { DashboardProjectTable } from "./dashboard-project-table";
import { DashboardFollowUps } from "./dashboard-follow-ups";
import { DashboardSiteManagerTable } from "./dashboard-site-manager-table";

interface DashboardHomeProps {
  userFirstName: string;
}

export function DashboardHome({ userFirstName }: DashboardHomeProps) {
  return (
    <div className="grid gap-6 space-y-6">
      <DashboardHeader
        name={userFirstName}
        newLeadsCount={0}
        newProjectsCount={0}
        followUpsCount={0}
      />
      <DashboardKPI
        newLeadsThisMonth={{ total: 0, trendDelta: 0 }}
        newLeadsConvertedThisMonth={{ total: 0, trendDelta: 0 }}
        revenueThisQuarter={{ total: 0, trendDelta: 0 }}
        netProfitThisQuarter={{ total: 0, trendDelta: 0 }}
        activeProjects={{ total: 0, trendDelta: 0 }}
        activeSiteManagers={{ total: 0, trendDelta: 0 }}
        estimateProjectSpendingThisQuarter={{ total: 0, trendDelta: 0 }}
        actualProjectSpendingThisQuarter={{ total: 0, trendDelta: 0 }}
      />

      <DashboardProjectTable
        projects={[]}
        pageInfo={{ totalCount: 0, totalPages: 0, currentPage: 1 }}
        onPageChange={(page) => console.log("Page changed to:", page)}
        onSearch={(query) => console.log("Search query:", query)}
      />
      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <DashboardSiteManagerTable
          siteManagers={[]}
        />

        <DashboardFollowUps
          pendingFollowUpCount={0}
          followUpItems={[]}
        />
      </div>
    </div>
  );
}
