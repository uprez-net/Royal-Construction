import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Hourglass, Receipt, RefreshCw } from "lucide-react";

interface DataPoint {
  total: number;
  trendDelta: number;
}

interface OfferKPIProps {
  activeOffers: DataPoint;
  approvedOffers: DataPoint;
  pendingOffers: DataPoint;
  activeVariationOffers: DataPoint;
}

function TrendBadge({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold",
        isPositive
          ? "bg-emerald-100 text-emerald-700"
          : "bg-red-100 text-red-700",
      ].join(" ")}
    >
      {isPositive ? "+" : ""}
      {value}%
    </span>
  );
}

export function OfferKPI({
  activeOffers,
  approvedOffers,
  pendingOffers,
  activeVariationOffers,
}: OfferKPIProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="border-border/70 bg-white/95">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="grid size-11 place-items-center rounded-xl bg-teal-600 text-white">
              <Receipt className="size-5" />
            </div>
            <TrendBadge value={activeOffers.trendDelta} />
          </div>
          <p className="text-3xl font-bold">{activeOffers.total}</p>
          <p className="text-xs text-muted-foreground">Active Offers</p>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white/95">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="grid size-11 place-items-center rounded-xl bg-yellow-500 text-white">
              <Hourglass className="size-5" />
            </div>
            <TrendBadge value={pendingOffers.trendDelta} />
          </div>
          <p className="text-3xl font-bold">{pendingOffers.total}</p>
          <p className="text-xs text-muted-foreground">Pending Offers</p>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white/95">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="grid size-11 place-items-center rounded-xl bg-emerald-600 text-white">
              <CheckCircle2 className="size-5" />
            </div>
            <TrendBadge value={approvedOffers.trendDelta} />
          </div>
          <p className="text-3xl font-bold">{approvedOffers.total}</p>
          <p className="text-xs text-muted-foreground">Approved Offers</p>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-white/95">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="mb-3 grid size-11 place-items-center rounded-xl bg-orange-500 text-white">
              <RefreshCw className="size-5" />
            </div>
            <TrendBadge value={activeVariationOffers.trendDelta} />
          </div>
          <p className="text-3xl font-bold">{activeVariationOffers.total}</p>
          <p className="text-xs text-muted-foreground">Active Variation</p>
        </CardContent>
      </Card>
    </div>
  );
}
