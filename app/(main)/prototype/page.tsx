// PROTOTYPE — throwaway route. Delete with the branch once the direction is
// settled. Nothing in production imports it.
//
// Three executions of the offer-workspace redesign, switchable via ?v=a|b|c
// and the floating bar at the bottom. State is in memory only.
//
// The variant is read client-side inside a Suspense boundary: awaiting
// searchParams here would make the whole route a blocking dynamic render
// (Cache Components).

import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PrototypeScreen } from "@/components/offers/prototype-offer-workspace/prototype-screen";

export const metadata: Metadata = {
  title: "Offer workspace prototype",
  robots: { index: false, follow: false },
};

export default function PrototypePage() {
  // This is throwaway design exploration, not a feature. It is a real route the
  // moment it exists, so keep it off production: dev and the staging preview
  // only (APP_ENV=staging, same signal the sandbox banner uses).
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_ENV !== "staging"
  ) {
    notFound();
  }

  return (
    <Suspense
      fallback={
        <div className="h-[calc(100dvh-6.5rem)] animate-pulse rounded-lg border border-border/70 bg-white/60" />
      }
    >
      <PrototypeScreen />
    </Suspense>
  );
}
