import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setQuery } from "@/lib/store/slices/tradieManagementSlice";
import { useMemo } from "react";
import { HardHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TradieRow, TradieTableQuery } from "@/types/tradie";
import { TradieCategory } from "./tabs/tradie-category";
import { TradieTable } from "./tabs/tradie-table";
import {
  CLEARED_TRADIE_QUERY,
  TRADIE_VIEW_PANEL_ID,
  hasActiveTradieFilters,
  tradieViewTabId,
} from "./tradie-tabs";

/**
 * Single filter predicate for both views. The Category view used to honour only
 * search + favourite, so a trade or rating filter set elsewhere silently stopped
 * applying when the user switched view. Both views now agree.
 */
function matchesTradieQuery(tradie: TradieRow, query: TradieTableQuery) {
  const search = query.search?.trim().toLowerCase();

  if (search && !tradie.name.toLowerCase().includes(search)) {
    return false;
  }

  if (query.category && !tradie.trades.includes(query.category)) {
    return false;
  }

  // Minimum-rating semantics. Ratings are decimals, so an exact match meant a
  // "3 stars" filter hid a 3.4 tradie. Missing ratings still default to 0 so
  // unrated tradies stay out of every rating filter.
  if (query.rating !== undefined && Number(tradie.rating ?? 0) < query.rating) {
    return false;
  }

  if (query.favourite !== undefined && tradie.isFavourite !== query.favourite) {
    return false;
  }

  if (query.tab === "flagged" && tradie.incidentCount.open === 0) {
    return false;
  }

  return true;
}

export function TradieBody() {
  const dispatch = useAppDispatch();
  const { query, activeTab, tradies, tradiesByCategory } = useAppSelector(
    (state) => state.tradieManagement,
  );

  const filteredTradies = useMemo(
    () => tradies.filter((tradie) => matchesTradieQuery(tradie, query)),
    [tradies, query],
  );

  const filteredTradiesByCategory = useMemo(() => {
    return tradiesByCategory
      .map((category) => ({
        ...category,
        tradies: category.tradies.filter((tradie) =>
          matchesTradieQuery(tradie, query),
        ),
      }))
      .filter((category) => category.tradies.length > 0);
  }, [tradiesByCategory, query]);

  const filtersActive = hasActiveTradieFilters(query);

  const groupedEmptyState = (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-16 text-center shadow-sm">
      <HardHat className="size-5 text-muted-foreground" aria-hidden="true" />

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {filtersActive ? "No tradies match these filters" : "No tradies yet"}
        </p>

        <p className="text-xs text-muted-foreground">
          {filtersActive
            ? "Try a broader search, or clear the filters to see every trade category."
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
  );

  const panel = (() => {
    switch (activeTab) {
      case "category":
        return filteredTradiesByCategory.length > 0 ? (
          <TradieCategory filteredTradies={filteredTradiesByCategory} />
        ) : (
          groupedEmptyState
        );
      case "list":
        return <TradieTable filteredTradies={filteredTradies} />;
      default:
        return null;
    }
  })();

  return (
    <div
      role="tabpanel"
      id={TRADIE_VIEW_PANEL_ID}
      aria-labelledby={tradieViewTabId(activeTab)}
      tabIndex={0}
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {panel}
    </div>
  );
}
