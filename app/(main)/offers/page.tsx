import { OfferFilter } from "@/components/offers/offer-filter";
import { OfferHeader } from "@/components/offers/offer-header";
import { OfferKPI } from "@/components/offers/offer-kpi";
import { OfferTable } from "@/components/offers/offer-table";
import { Card } from "@/components/ui/card";
import {
  emptyOfferGroupResult,
  emptyOfferKPIs,
  getOfferGroupsCached,
  getOfferKPIsCached,
} from "@/lib/data/offer-listing";
import { getUserByClerkId } from "@/lib/data/user";
import { leadListScope } from "@/lib/offer/access";
import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { Suspense } from "react";
import OfferPageSkeleton from "./loading";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offers Management",
  description: "Manage and track your construction project offers effectively.",
};

async function OfferPageClient() {
  // Prevent build-time prerender DB queries; render this page at request time.
  await connection();
  // The user is resolved here, outside the cached fetchers: a "use cache" scope
  // cannot read the request, so the scope goes in as a cache-key argument. No
  // internal user means no scope, and nothing is read. The lookup is uncached,
  // as in authorizeLeadAccess, so a role change narrows the list at once.
  const { userId } = await auth();
  const user = userId ? await getUserByClerkId(userId) : null;
  const scope = user ? leadListScope(user) : null;
  const [offerKPIs, offers] = scope
    ? await Promise.all([
        getOfferKPIsCached(scope),
        getOfferGroupsCached(1, 10, "", "all", scope),
      ])
    : [emptyOfferKPIs(), emptyOfferGroupResult(1, 10)];

  return (
    <div className="space-y-6">
      <OfferHeader />
      <OfferKPI
        activeOffers={offerKPIs.allOffers}
        approvedOffers={offerKPIs.approvedOffers}
        pendingOffers={offerKPIs.pendingOffers}
        sentOffers={offerKPIs.sentOffers}
        totalVersions={offerKPIs.totalVersions}
      />
      <Card className="border-border/70 bg-white/95 shadow-sm">
        <OfferFilter
          initialTabCounts={{
            all: offerKPIs.allOffers.total,
            pending: offerKPIs.pendingOffers.total,
            approved: offerKPIs.approvedOffers.total,
            rejected: offerKPIs.rejectedOffers.total,
            sent: offerKPIs.sentOffers.total,
          }}
        />
        <OfferTable serverOffers={offers} />
      </Card>
    </div>
  );
}

export default function OfferPage() {
  return (
    <Suspense fallback={<OfferPageSkeleton />}>
      <OfferPageClient />
    </Suspense>
  );
}
