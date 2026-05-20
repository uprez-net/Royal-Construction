import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";

//export const dynamic = 'force-dynamic';

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await auth();

  return (
    <AppShell
      description="BuildPro - One place for all your construction project management needs."
      isSignedIn={user.isAuthenticated}
    >
      {children}
    </AppShell>
  );
}