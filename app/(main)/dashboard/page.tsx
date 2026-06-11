import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { auth } from "@clerk/nextjs/server";
import { getProjects } from "@/lib/data/projects";
import { getDashboardFollowUps, getDashboardKPIData } from "@/lib/data/dashboard";
import { connection } from "next/server";

export default async function DashboardPageClient() {
  await connection()
  const [user, projects, dashboardKPI, followUpItems] = await Promise.all([
    auth(),
    getProjects({
      page: 1,
      limit: 10,
      status: "ACTIVE",
    }),
    getDashboardKPIData(),
    getDashboardFollowUps(),
  ]);

  return (
    <DashboardHome
      userFirstName={user.sessionClaims?.firstName ?? "User"} 
      projectsData={projects}
      kpiData={dashboardKPI}
      newLeadsCount={dashboardKPI.newLeadsThisMonth.total}
      newProjectsCount={dashboardKPI.newProjectsCount}
      followUpsCount={dashboardKPI.followUpsCount}
      followUpItems={followUpItems}
     />
  );
}
