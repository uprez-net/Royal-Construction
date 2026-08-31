"use client";
import { CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { Input } from "../ui/input";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { fetchOffers } from "@/lib/store/slices/offerSlice";
import type { OfferStatusBucket } from "@/types/offer";

interface OfferFilterProps {
  /**
   * Global, per-bucket lead counts from `getOfferKPIs`. These are the same
   * numbers the KPI cards show, so the tab badges stay consistent with the cards
   * regardless of which page/search the table is on. The badges are deliberately
   * *not* recomputed from the current page slice: a 10-row page can't sum to the
   * population, and the old recompute dropped every lead whose representative
   * revision was in a modern lifecycle state (AGREED, TENDER_SIGNED, ...) because
   * it mapped each tab to a single `OfferStatus`.
   */
  initialTabCounts: Record<OfferStatusBucket, number>;
}

const TABS = ["all", "pending", "approved", "rejected", "sent"] as const;

export function OfferFilter({ initialTabCounts }: OfferFilterProps) {
  const dispatch = useAppDispatch();
  const { offers, filters } = useAppSelector((state) => state.offers);
  const [searchInput, setSearchInput] = useState(filters.q);
  // Seed from the store so a re-mount after a client-side fetch (e.g. navigating
  // into an offer and back via the browser) keeps the active tab selected.
  const [tabId, setTabId] = useState<OfferStatusBucket>(filters.status);

  const handleTabChange = (tab: OfferStatusBucket) => {
    if (tab === tabId) return;
    setTabId(tab);
    // A tab change starts a fresh filtered view on page 1, carrying the current
    // search term so the two filters compose.
    dispatch(
      fetchOffers({
        status: tab,
        q: searchInput,
        page: 1,
        limit: offers.limit || 10,
      }),
    );
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchInput(query);
    // Re-fetch on every change *including clear*: the old guard returned early
    // on an empty string, so clearing the box left the filtered results on
    // screen. An empty string maps to "no query" server-side.
    dispatch(
      fetchOffers({
        q: query,
        status: tabId,
        page: 1,
        limit: offers.limit || 10,
      }),
    );
  };

  return (
    <CardHeader className="border-b border-border/70 px-5 py-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 pb-4">
          {TABS.map((tab) => {
            const active = tabId === tab;

            return (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={cn(
                  "group relative inline-flex h-9 items-center rounded-md px-3 text-[12.5px] font-semibold transition-all duration-200",
                  active
                    ? "bg-teal-50 text-teal-700 shadow-sm"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span>
                  {tab === "all"
                    ? "All"
                    : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </span>

                <span
                  className={cn(
                    "ml-2 inline-flex min-w-4.5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold transition-colors",
                    active
                      ? "bg-teal-600 text-white"
                      : "bg-muted text-muted-foreground group-hover:bg-background",
                  )}
                >
                  {initialTabCounts[tab]}
                </span>

                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-teal-600" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-70 flex-1">
            <label htmlFor="search" className="sr-only">
              Search
            </label>

            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            <Input
              id="search"
              className="h-10 rounded-lg border-border bg-background pl-9 text-[13px] shadow-none transition-all focus-visible:ring-4 focus-visible:ring-teal-500/10 focus-visible:border-teal-600"
              placeholder="Search offers..."
              value={searchInput}
              onChange={handleSearchChange}
            />
          </div>

          {/* Reflects the *current view* (filtered + searched), not the global
              KPI total — that's what `offers.totalCount` holds after a fetch,
              and it is what the pagination footer divides up. */}
          <p className="ml-auto whitespace-nowrap text-[12px] font-medium text-muted-foreground">
            {offers.totalCount} results
          </p>
        </div>
      </div>
    </CardHeader>
  );
}
