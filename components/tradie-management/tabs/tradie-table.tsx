import { DataTable, type ColumnAlign } from "@/components/common/data-table";
import { RatingStars } from "@/components/common/rating-stars";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setQuery } from "@/lib/store/slices/tradieManagementSlice";
import { TradieRow } from "@/types/tradie";
import { rateCurrency } from "@/utils/formatters";
import { HardHat } from "lucide-react";
import { useRouter } from "next/navigation";
import { TradieBadge } from "../trade-badge";
import { TradieActionsDropdown } from "../tradie-actions";
import { CLEARED_TRADIE_QUERY, hasActiveTradieFilters } from "../tradie-tabs";
import { formatQuotedPrice } from "@/utils/calculations";

const COLUMN_ALIGN: ColumnAlign[] = [
  "start", // Tradie
  "start", // Trade
  "end", // Rate
  "start", // Rating
  "end", // Jobs
  "end", // Incidents
  "start", // Actions
];

function formatPrice(price: string | null, unit: "HOURLY" | "FIXED") {
  if (price === null) return "—";
  const parsed = parseFloat(price);
  if (!Number.isFinite(parsed)) return "—";
  return formatQuotedPrice(parsed, unit, rateCurrency.format);
}

export function TradieTable({
  filteredTradies,
}: {
  filteredTradies: TradieRow[];
}) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { query } = useAppSelector((state) => state.tradieManagement);
  const filtersActive = hasActiveTradieFilters(query);

  return (
    <DataTable
      caption="Tradies with their trade, last quoted price, rating, completed jobs and incident counts."
      headers={["Tradie", "Trade", "Last Quoted Price", "Rating", "Jobs", "Incidents", "Actions"]}
      align={COLUMN_ALIGN}
      rows={filteredTradies.map((tradie) => [
        tradie.name,
        <TradieBadge trade={tradie.trade} key={`trade-${tradie.id}`} />,
        <span key={`rate-${tradie.id}`} className="whitespace-nowrap">
          <span className="font-mono tabular-nums">
            {formatPrice(tradie.lastQuotedPrice, tradie.lastQuotedPriceUnit)}
          </span>
        </span>,
        <RatingStars
          rating={parseFloat(tradie.rating ?? "0")}
          key={`rating-${tradie.id}`}
        />,
        tradie.jobsCompleted,
        // Open incidents are the alert concept of this page, so they get badge
        // weight instead of being buried in a "2 open / 3 closed" string. The
        // word "open" carries the meaning; the tint only reinforces it.
        <span
          key={`incidents-${tradie.id}`}
          className="inline-flex items-center justify-end gap-2 whitespace-nowrap"
        >
          {tradie.incidentCount.open > 0 ? (
            <span className="rounded-full bg-destructive-light px-2 py-0.5 text-xs font-medium tabular-nums text-destructive-ink">
              {tradie.incidentCount.open} open
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">None open</span>
          )}

          <span className="text-xs tabular-nums text-muted-foreground">
            {tradie.incidentCount.resolved} closed
          </span>
        </span>,
        <TradieActionsDropdown tradieRow={tradie} key={`actions-${tradie.id}`} />,
      ])}
      emptyState={
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
          <HardHat className="size-5 text-muted-foreground" aria-hidden="true" />

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {filtersActive
                ? "No tradies match these filters"
                : "No tradies yet"}
            </p>

            <p className="text-xs text-muted-foreground">
              {filtersActive
                ? "Try a broader search, or clear the filters to see every tradie."
                : "Add your first tradie to start tracking rates, jobs and incidents."}
            </p>
          </div>

          {filtersActive && (
            <Button
              variant="outline"
              onClick={() => dispatch(setQuery(CLEARED_TRADIE_QUERY))}
            >
              Clear filters
            </Button>
          )}
        </div>
      }
      rowLabel={(row) => `Open ${filteredTradies[row].name}`}
      onRowClick={(row) => {
        const tradieId = filteredTradies[row].id;
        router.push(`/tradie-management/${tradieId}`);
      }}
    />
  );
}
