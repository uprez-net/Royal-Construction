import { OfferFilter } from "@/components/offers/offer-filter";
import { OfferHeader } from "@/components/offers/offer-header";
import { OfferKPI } from "@/components/offers/offer-kpi";
import { OfferTable } from "@/components/offers/offer-table";
import { Card } from "@/components/ui/card";
import { getOfferKPIsCached, getOffersCached } from "@/lib/data/offers";
import { connection } from "next/server";


export default async function QuotationsPage() {
  // Prevent build-time prerender DB queries; render this page at request time.
  await connection();
  const [offerKPIs, offers] = await Promise.all([
    getOfferKPIsCached(),
    getOffersCached(1, 10),
  ]);

  return (
    <div className="space-y-6">
      <OfferHeader />
      <OfferKPI
        activeOffers={{
          total: offerKPIs.allOffers.total,
          trendDelta: offerKPIs.allOffers.trendDelta,
        }}
        approvedOffers={{
          total: offerKPIs.approvedOffers.total,
          trendDelta: offerKPIs.approvedOffers.trendDelta,
        }}
        pendingOffers={{
          total: offerKPIs.pendingOffers.total,
          trendDelta: offerKPIs.pendingOffers.trendDelta,
        }}
        activeVariationOffers={{
          total: offerKPIs.sentOffers.total,
          trendDelta: offerKPIs.sentOffers.trendDelta,
        }}
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
          initialTotalCount={offerKPIs.allOffers.total}
        />
        <OfferTable serverQuotes={offers} />
      </Card>
    </div>
  );
}
