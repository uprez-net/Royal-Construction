import { Suspense } from "react";
import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";
import { AppShellLoader } from "@/components/common/app-shell-loader";
import { getUserByClerkIdCached } from "@/lib/data/user";

const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "196994eb-5059-4fe8-ac4e-7c6d9934bbcf";

async function LayoutContent({ children }: { children: React.ReactNode }) {
  let isAdmin = false;
  const user = await auth();
  if(user.isAuthenticated) {
    const dbUser = await getUserByClerkIdCached(user.userId as string);
    isAdmin = dbUser?.id === ADMIN_USER_ID;
  }

  return (
    <AppShell
      isAdmin={isAdmin}
      description="Royal Constructions - One place for all your construction project management needs."
      isSignedIn={user.isAuthenticated}
    >
      {children}
    </AppShell>
  );
}

function LayoutFallback({ children }: { children: React.ReactNode }) {
  return <AppShellLoader>{children}</AppShellLoader>;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<LayoutFallback>{children}</LayoutFallback>}>
      <LayoutContent>{children}</LayoutContent>
    </Suspense>
  );
}
