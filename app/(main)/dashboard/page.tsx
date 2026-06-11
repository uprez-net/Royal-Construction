import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { auth } from "@clerk/nextjs/server";

export default async function DashboardPageClient() {
  const [user] = await Promise.all([auth()]);

  return (
    <DashboardHome
      userFirstName={user.sessionClaims?.firstName ?? "User"} 
      
     />
  );
}
