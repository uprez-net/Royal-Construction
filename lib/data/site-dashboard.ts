import "server-only";

import type { FollowUpItem } from "@/components/dashboard/dashboard-follow-ups";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  listProjectFollowUpsDue,
  listSiteManagerPerformance,
  type SiteManagerPerformance,
} from "@/lib/domain/projects/site-dashboard";
import { formatSydneyDate } from "@/lib/dates/sydney";
import prisma from "@/lib/prisma";

// The Next adapter over `lib/domain/projects/site-dashboard.ts`: who is asking,
// and the shape the dashboard cards draw. The rules are in the domain.

export type SiteDashboardData = {
  readonly performance: SiteManagerPerformance[];
  readonly followUps: FollowUpItem[];
};

/** The same per-manager read a site manager's dashboard shows, for the admin's. */
export async function getSiteManagerPerformance(): Promise<
  SiteManagerPerformance[]
> {
  return listSiteManagerPerformance(await currentPrincipal(), prisma);
}

export async function getSiteDashboardData(): Promise<SiteDashboardData> {
  const principal = await currentPrincipal();
  const [performance, followUps] = await Promise.all([
    listSiteManagerPerformance(principal, prisma),
    listProjectFollowUpsDue(principal, {}, prisma),
  ]);

  return {
    followUps: followUps.map((followUp) => ({
      customerName: followUp.customerName,
      description: followUp.description,
      // A calendar date, not a moment: the card would otherwise print the
      // clock face of a date that has none.
      dueAt: followUp.dueAt,
      dueLabel: formatSydneyDate(followUp.dueAt),
      id: followUp.id,
      projectName: followUp.projectName,
      status: "negative",
    })),
    performance,
  };
}
