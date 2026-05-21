import { Suspense } from "react";
import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";
import { AppShellLoader } from "@/components/common/app-shell-loader";

async function LayoutContent({ children }: { children: React.ReactNode }) {
  const user = await auth();

  return (
    <AppShell
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
