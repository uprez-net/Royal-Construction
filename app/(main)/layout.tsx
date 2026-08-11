import { Suspense } from "react";
import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";
import { AppShellLoader } from "@/components/common/app-shell-loader";
import { getUserByClerkIdCached } from "@/lib/data/user";

async function LayoutContent({ children }: { children: React.ReactNode }) {
  const user = await auth().then(async ({ userId }) => userId ? await getUserByClerkIdCached(userId) : null);

  return (
    <AppShell
      isAdmin={user?.role === "ADMIN"}
      description="Royal Constructions - One place for all your construction project management needs."
      isSignedIn={!!user}
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
