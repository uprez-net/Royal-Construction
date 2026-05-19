import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { DashboardHome } from "@/components/dashboard/dashboard-home";

async function HomeContent() {
  const user = await auth();

  return <DashboardHome isSignedIn={user.isAuthenticated} />;
}

export default function Home() {
  return (
    <Suspense fallback={<DashboardHome isSignedIn={false} />}>
      <HomeContent />
    </Suspense>
  );
}
