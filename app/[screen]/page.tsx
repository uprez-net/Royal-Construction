import { notFound } from "next/navigation";

import { AppShell } from "@/components/common/app-shell";
import { getScreenTitle, screenRegistry } from "@/lib/mock-data";
import { auth } from "@clerk/nextjs/server";

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  const user = await auth();
  const Screen = screenRegistry[screen];

  if (!Screen) {
    notFound();
  }

  return (
    <AppShell
      activeSlug={screen}
      title={getScreenTitle(screen)}
      description="Converted from the original HTML mockups into a shared, composable Next.js screen architecture."
      isSignedIn={user.isAuthenticated}
    >
      {Screen()}
    </AppShell>
  );
}

export function generateStaticParams() {
  return Object.keys(screenRegistry).map((screen) => ({ screen }));
}
