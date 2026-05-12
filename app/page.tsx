"use server";

import { DashboardHome } from "@/components/dashboard/dashboard-home"
import { auth } from "@clerk/nextjs/server"

export default async function Home() {
  const user = await auth();
  
  return <DashboardHome isSignedIn={user.isAuthenticated} />
}
