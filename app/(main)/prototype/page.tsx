// A design surface, not a feature. Nothing in production imports it, and the
// route 404s outside development and staging.
//
// It was built to choose the offer-workspace shell, which it did. It is kept
// deliberately rather than deleted, because the dwellings/duplex model and the
// offer packages are both still to be designed and this is where that happens
// without touching the live workspace. Delete it when both have shipped.
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
  // A route is real the moment it exists, so keep this one off production: dev
  // and the staging preview only (APP_ENV=staging, the same signal the sandbox
  // banner uses). This gate is what makes keeping the prototype safe.
  if (
    process.env.NODE_ENV === "production"
    && process.env.APP_ENV !== "staging"
  ) {
    notFound();
  }

  return (
    <Suspense
      fallback={
        <div className="h-[calc(100dvh-6.5rem)] animate-pulse rounded-lg border border-border/70 bg-card/60" />
      }
    >
      <PrototypeScreen />
    </Suspense>
  );
}
