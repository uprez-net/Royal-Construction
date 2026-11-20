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
  isAdmin: boolean;
  today: string;
  kpiData: DashboardKPIType;
  projectsData: PaginatedProjectsResult;
  followUpItems: FollowUpItem[];
  graphData: DashboardGraphData;
  dataWarnings?: string[];
}

/** Which sections fell back to empty because their read failed. */
export function DashboardDataWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm text-foreground">
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold">
          Some dashboard sections are temporarily unavailable.
        </p>
        <p className="text-muted-foreground">
          Showing available data while {warnings.join(", ")} refreshes.
        </p>
      </div>
    </div>
  );
}

export function DashboardHome({
  isAdmin,
  today,
  kpiData,
  projectsData,
  followUpItems,
  graphData,
  dataWarnings = [],
}: DashboardHomeProps) {
  return (
    <div className="flex flex-col gap-6 lg:gap-7">
      <DashboardDataWarnings warnings={dataWarnings} />
      <section className="flex flex-col gap-4 lg:gap-5">
        <DashboardHeader today={today} />
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
      </section>

      <DashboardGraphCards data={graphData} />

      <DashboardProjectTable isAdmin={isAdmin} initialProjects={projectsData} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
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
