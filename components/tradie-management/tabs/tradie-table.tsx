import { DataTable } from "@/components/common/data-table";
import { RatingStars } from "@/components/common/rating-stars";
import { Button } from "@/components/ui/button";
import { TradieRow } from "@/types/tradie";
import { currency } from "@/utils/formatters";
import { HardHat, MoreVertical } from "lucide-react";
import { useRouter } from "next/navigation";

export function TradieTable({
  filteredTradies,
}: {
  filteredTradies: TradieRow[];
}) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <DataTable
        headers={[
          "Tradie",
          "Trade",
          "Rate",
          "Rating",
          "Jobs",
          "Incidents",
          "Actions",
        ]}
        rows={filteredTradies.map((tradie) => [
          tradie.name,
          tradie.trade,
          <span key={`rate-${tradie.id}`}>
            {tradie.hourlyRate
              ? currency.format(parseFloat(tradie.hourlyRate))
              : "-"}
              <span className="text-xs text-muted-foreground">/hr</span>
          </span>,
          <RatingStars rating={parseFloat(tradie.rating ?? "0")} key={`rating-${tradie.id}`} />,
          tradie.jobsCompleted,
          `${tradie.incidentCount.open} open / ${tradie.incidentCount.resolved} closed`,
          <Button
            key={`actions-${tradie.id}`}
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>,
        ])}
        emptyState={
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="flex size-12 items-center justify-center">
              <HardHat className="size-5 text-muted-foreground" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No tradies found
              </p>

              <p className="text-xs text-muted-foreground">
                Your tradies will appear here.
              </p>
            </div>
          </div>
        }
        onRowClick={(row) => {
          const tradieId = filteredTradies[row].id;
          router.push(`/tradie-management/${tradieId}`);
        }}
      />
    </div>
  );
}
