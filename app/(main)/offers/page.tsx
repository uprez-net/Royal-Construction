import { OfferFilter } from "@/components/offers/offer-filter";
import { OfferFollowUpAlerts } from "@/components/offers/offer-follow-up-alerts";
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
import { getOfferFollowUpAlerts } from "@/lib/data/offer-follow-ups";
import { getUserByClerkId } from "@/lib/data/user";
import { userPrincipal } from "@/lib/domain/principal";
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
  const [offerKPIs, offers, followUps] =
    user && scope
      ? await Promise.all([
          getOfferKPIsCached(scope),
          getOfferGroupsCached(1, 10, "", "all", scope),
          // Uncached: an offer falls due because a day passed (issue #449).
          getOfferFollowUpAlerts(userPrincipal(user)),
        ])
      : [
          emptyOfferKPIs(),
          emptyOfferGroupResult(1, 10),
          { alerts: [], failed: false },
        ];

  return (
    <div className="space-y-6">
      <OfferHeader />
      <OfferFollowUpAlerts
        alerts={followUps.alerts}
        failed={followUps.failed}
        senderName={user?.name?.trim() || null}
      />
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
            // Every offer not rejected: what the All tab lists (issue #450).
            all: offerKPIs.openOffers,
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
