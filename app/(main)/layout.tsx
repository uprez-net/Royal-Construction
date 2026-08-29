import { Suspense } from "react";
import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";
import { AppShellLoader } from "@/components/common/app-shell-loader";
import { getUserByClerkIdCached } from "@/lib/data/user";

async function LayoutContent({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const user = userId ? await getUserByClerkIdCached(userId) : null;

  return (
    <AppShell
      isAdmin={user?.role === "ADMIN"}
      role={user?.role}
      description="Royal Constructions - One place for all your construction project management needs."
      // Signed in is a question about the Clerk session, not about our database.
      // Deriving it from the User row meant that anyone authenticated whose row
      // was missing or whose `user-<clerkId>` cache had not caught up saw the
      // signed-out header — and, worse, lost the entire global WebMCP tool
      // surface, while screen tools carried on registering. The role is a
      // separate question and is still allowed to be undefined.
      isSignedIn={!!userId}
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
