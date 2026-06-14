import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { auth } from "@clerk/nextjs/server";
import { getProjects } from "@/lib/data/projects";
import { getDashboardFollowUps, getDashboardGraphData, getDashboardKPIData } from "@/lib/data/dashboard";
import { connection } from "next/server";

export default async function DashboardPageClient() {
  await connection()
  const [user, projects, dashboardKPI, followUpItems, graphData] = await Promise.all([
    auth(),
    getProjects({
      page: 1,
      limit: 10,
      status: "ACTIVE",
    }),
    getDashboardKPIData(),
    getDashboardFollowUps(),
    getDashboardGraphData(),
  ]);

  return (
    <DashboardHome
      userFirstName={user.sessionClaims?.firstName ?? "User"}
      graphData={graphData}
      projectsData={projects}
      kpiData={dashboardKPI}
      newLeadsCount={dashboardKPI.newLeadsThisMonth.total}
      newProjectsCount={dashboardKPI.newProjectsCount}
      followUpsCount={dashboardKPI.followUpsCount}
      followUpItems={followUpItems}
     />
  );
}
