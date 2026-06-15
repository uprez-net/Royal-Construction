"use client";
import { AlertTriangle } from "lucide-react";
import { DashboardHeader } from "./dashboard-header";
import { DashboardKPI } from "./dashboard-kpi";
import { DashboardProjectTable } from "./dashboard-project-table";
import { DashboardFollowUps } from "./dashboard-follow-ups";
import { DashboardSiteManagerTable } from "./dashboard-site-manager-table";
import { DashboardKPI as DashboardKPIType } from "@/types/dashboard";
import type { PaginatedProjectsResult } from "@/lib/data/projects";
import { siteManagersMock } from "@/lib/mock-data";
import type { FollowUpItem } from "./dashboard-follow-ups";
import { DashboardGraphCards } from "./dashboard-graph-cards";
import type { DashboardGraphData } from "@/lib/data/dashboard";

interface DashboardHomeProps {
  userFirstName: string;
  newLeadsCount: number;
  newProjectsCount: number;
  followUpsCount: number;
  kpiData: DashboardKPIType;
  projectsData: PaginatedProjectsResult;
  followUpItems: FollowUpItem[];
  graphData: DashboardGraphData;
  dataWarnings?: string[];
}

export function DashboardHome({
  userFirstName,
  newLeadsCount,
  newProjectsCount,
  followUpsCount,
  kpiData,
  projectsData,
  followUpItems,
  graphData,
  dataWarnings = [],
}: DashboardHomeProps) {
  return (
    <div className="grid gap-6 space-y-6">
      {dataWarnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-light)] px-4 py-3 text-sm text-foreground">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-[color:var(--warning)]"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">Some dashboard sections are temporarily unavailable.</p>
            <p className="text-muted-foreground">
              Showing available data while {dataWarnings.join(", ")} refreshes.
            </p>
          </div>
        </div>
      )}
      <DashboardHeader
        name={userFirstName}
        newLeadsCount={newLeadsCount}
        newProjectsCount={newProjectsCount}
        followUpsCount={followUpsCount}
      />
      <DashboardKPI
        newLeadsThisMonth={kpiData.newLeadsThisMonth}
        newLeadsConvertedThisMonth={kpiData.newLeadsConvertedThisMonth}
        revenueThisQuarter={kpiData.revenueThisQuarter}
        netProfitThisQuarter={kpiData.netProfitThisQuarter}
        activeProjects={kpiData.activeProjects}
        activeSiteManagers={kpiData.activeSiteManagers}
        estimateProjectSpendingThisQuarter={
          kpiData.estimateProjectSpendingThisQuarter
        }
        actualProjectSpendingThisQuarter={
          kpiData.actualProjectSpendingThisQuarter
        }
      />

      {/* Graph Cards */}
      <DashboardGraphCards data={graphData} />

      <DashboardProjectTable
        projects={projectsData.items}
        pageInfo={{
          totalCount: projectsData.totalCount,
          totalPages: projectsData.totalPages,
          currentPage: projectsData.page,
        }}
        onPageChange={(page) => console.log("Page changed to:", page)}
        onSearch={(query) => console.log("Search query:", query)}
      />

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <DashboardSiteManagerTable siteManagers={siteManagersMock} />

        <DashboardFollowUps
          followUpTone={followUpItems.length === 0 ? "positive" : "negative"}
          pendingFollowUpCount={followUpItems.length}
          followUpItems={followUpItems}
        />
      </div>
    </div>
  );
}
