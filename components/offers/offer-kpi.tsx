"use client"
import {
  CheckCircle2,
  Hourglass,
  Receipt,
  Send,
} from "lucide-react";
import { DataPoint, KPIListItem, MetricCard } from "../common/metric-card";

interface OfferKPIProps {
  activeOffers: DataPoint;
  approvedOffers: DataPoint;
  pendingOffers: DataPoint;
  sentOffers: DataPoint;
}

export function OfferKPI({
  activeOffers,
  approvedOffers,
  pendingOffers,
  sentOffers,
}: OfferKPIProps) {
  const allKPIs: KPIListItem[] = [
    { title: "Active Offers", dataPoint: activeOffers, Icon: Receipt, iconTone: "bg-teal-600" },
    { title: "Approved Offers", dataPoint: approvedOffers, Icon: CheckCircle2, iconTone: "bg-green-600" },
    { title: "Pending Offers", dataPoint: pendingOffers, Icon: Hourglass, iconTone: "bg-yellow-600" },
    { title: "Sent Offers", dataPoint: sentOffers, Icon: Send, iconTone: "bg-blue-600" },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {allKPIs.map((kpi, index) => (
        <MetricCard
          key={index}
          title={kpi.title}
          value={kpi.dataPoint.total}
          trendDelta={kpi.dataPoint.trendDelta}
          Icon={kpi.Icon}
          iconTone={kpi.iconTone}
        />
      ))}
    </div>
  );
}
