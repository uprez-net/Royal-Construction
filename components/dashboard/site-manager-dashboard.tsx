"use client";
import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import type { PaginatedProjectsResult } from "@/lib/data/projects";

import { DashboardFollowUps, type FollowUpItem } from "./dashboard-follow-ups";
import { DashboardProjectTable } from "./dashboard-project-table";
import {
  DashboardSiteManagerTable,
  type SiteManagerPerformance,
} from "./dashboard-site-manager-table";

interface SiteManagerDashboardProps {
  today: string;
  projectsData: PaginatedProjectsResult;
  performance: SiteManagerPerformance[];
  followUpItems: FollowUpItem[];
}

/**
 * The dashboard a site manager is given: the live projects, how each manager is
 * getting on, and what falls due today.
 *
 * Not the sales dashboard with parts hidden. That one's header adds and exports
 * leads and its cards are revenue, profit and spend; leaving them out of the
 * markup would still leave them in the page's data, so a site manager's page is
 * built from its own reads (`lib/data/site-dashboard.ts`) and never fetches them.
 */
export function SiteManagerDashboard({
  today,
  projectsData,
  performance,
  followUpItems,
}: SiteManagerDashboardProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6 lg:gap-7">
      <PageHeader
        headingLevel="h1"
        title="Dashboard"
        description={today}
        actions={
          <Button
            variant="outline"
            size="icon"
            className="items-center justify-center"
            onClick={() => router.refresh()}
            aria-label="Refresh dashboard"
          >
            <RotateCw className="size-4" />
          </Button>
        }
      />

      <DashboardProjectTable isAdmin={false} initialProjects={projectsData} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <DashboardSiteManagerTable
          siteManagers={performance}
          canManage={false}
        />
        <DashboardFollowUps
          followUpTone={followUpItems.length === 0 ? "positive" : "negative"}
          pendingFollowUpCount={followUpItems.length}
          followUpItems={followUpItems}
        />
      </div>
    </div>
  );
}
