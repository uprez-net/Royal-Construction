"use client";
import { KpiBand } from "../common/kpi-band";
import { DataPoint, KPIListItem, MetricCard } from "../common/metric-card";

interface OfferKPIProps {
  activeOffers: DataPoint;
  approvedOffers: DataPoint;
  pendingOffers: DataPoint;
  sentOffers: DataPoint;
  /** Offer revisions behind these totals; only the "Total Offers" caption uses it. */
  totalVersions: number;
}

export function OfferKPI({
  activeOffers,
  approvedOffers,
  pendingOffers,
  sentOffers,
  totalVersions,
}: OfferKPIProps) {
  // Every count here is per lead, taken from that lead's active revision, so a
  // client re-priced four times is one offer in exactly one status bucket —
  // the same unit the table paginates over.
  const allKPIs: (KPIListItem & { caption?: string })[] = [
    {
      title: "Total Offers",
      dataPoint: activeOffers,
      caption:
        totalVersions > activeOffers.total
          ? `${totalVersions} versions across all offers`
          : undefined,
    },
    {
      title: "Approved Offers",
      dataPoint: approvedOffers,
    },
    {
      title: "Pending Offers",
      dataPoint: pendingOffers,
    },
    { title: "Sent Offers", dataPoint: sentOffers },
  ];
  return (
    <KpiBand className="grid-cols-2 xl:grid-cols-4">
      {allKPIs.map((kpi, index) => (
        <MetricCard
          key={index}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          caption={kpi.caption}
        />
      ))}
    </KpiBand>
  );
}
