"use client";
import { ResultStatus } from "@/components/common/result-status";
import { ListSortMenu } from "@/components/common/list-sort-menu";
import { MobileFilterSelect } from "@/components/common/mobile-filter-select";
import {
  FilterChip,
  FilterChips,
  ListToolbar,
  TableCard,
  ToolbarSearch,
} from "@/components/common/list-toolbar";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { fetchOffers } from "@/lib/store/slices/offerSlice";
import type { OfferStatusBucket } from "@/types/offer";
import { OFFER_SORT_OPTIONS } from "@/lib/offer/offer-listing-view";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface OfferFilterProps {
  /**
   * Global, per-bucket lead counts from `queryOfferKPIs`. These are the same
   * numbers the KPI cards show, so the tab badges stay consistent with the cards
   * regardless of which page/search the table is on. The badges are deliberately
   * *not* recomputed from the current page slice: a 10-row page can't sum to the
   * population, and the old recompute dropped every lead whose representative
   * revision was in a modern lifecycle state (AGREED, TENDER_SIGNED, ...) because
   * it mapped each tab to a single `OfferStatus`.
   */
  initialTabCounts: Record<OfferStatusBucket, number>;
  /** The offers table. It sits in the one card under the toolbar. */
  children: ReactNode;
}

const TABS = ["all", "pending", "approved", "rejected", "sent"] as const;

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The offers toolbar (search and sort, on the page) and the one card under it:
 * status chips in its header, then the table. Status and search compose.
 */
export function OfferFilter({ initialTabCounts, children }: OfferFilterProps) {
  const dispatch = useAppDispatch();
  const { offers, filters, hydrated } = useAppSelector((state) => state.offers);
  const [searchInput, setSearchInput] = useState(filters.q);
  // Follow the store on both request start and rollback after a failed fetch.
  const tabId = filters.status;
  // The box updates on every keystroke; the fetch waits for a pause in typing,
  // so a name costs one request rather than one per letter.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  /** Apply a status on page 1 and cancel a pending search that still targets the old status. */
  const handleTabChange = (tab: OfferStatusBucket) => {
    if (tab === tabId) return;
    // This fetch already carries the current search text. A search still
    // waiting on its debounce would refetch the previous tab over it.
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // A tab change starts a fresh filtered view on page 1, carrying the current
    // search term so the two filters compose.
    dispatch(
      fetchOffers({
        status: tab,
        q: searchInput,
        sort: filters.sort,
        page: 1,
        limit: offers.limit || 10,
      }),
    );
  };

  /** Debounce search requests, including clear, while retaining the selected status and sort. */
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchInput(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // Re-fetch on every change *including clear*: the old guard returned early
    // on an empty string, so clearing the box left the filtered results on
    // screen. An empty string maps to "no query" server-side.
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      dispatch(
        fetchOffers({
          q: query,
          status: tabId,
          sort: filters.sort,
          page: 1,
          limit: offers.limit || 10,
        }),
      );
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="space-y-5">
      {/* Reflects the *current view* (filtered + searched), not the global
          KPI total — that's what `offers.totalCount` holds after a fetch,
          and it is what the pagination footer divides up. Hidden until the
          store holds a result: before that it is the empty initial state,
          and a hard reload flashed "0 results". Always mounted, so the new
          count is announced when a search or filter changes it (#441). */}
      <ListToolbar
        start={
          <ResultStatus
            count={hydrated ? offers.totalCount : null}
            noun="result"
            className="whitespace-nowrap text-[12px] font-medium text-muted-foreground"
          />
        }
      >
        <ListSortMenu
          label="offers"
          value={filters.sort}
          options={OFFER_SORT_OPTIONS}
          onChange={(sort) => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
            dispatch(
              fetchOffers({
                sort,
                status: tabId,
                q: searchInput,
                page: 1,
                limit: offers.limit || 10,
              }),
            );
          }}
        />
        <ToolbarSearch
          id="search"
          aria-label="Search"
          placeholder="Search offer #, client, email, phone or suburb"
          value={searchInput}
          onChange={handleSearchChange}
        />
      </ListToolbar>

      <TableCard
        header={
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
            {/* Phones keep the native picker; from md the chips show. */}
            <MobileFilterSelect
              label="Offer status"
              value={tabId}
              options={TABS.map((tab) => ({
                value: tab,
                label:
                  tab === "all"
                    ? "All offers"
                    : tab.charAt(0).toUpperCase() + tab.slice(1),
                count: initialTabCounts[tab],
              }))}
              onChange={(value) => handleTabChange(value as OfferStatusBucket)}
            />
            <FilterChips
              role="group"
              aria-label="Offer status"
              className="hidden md:flex"
            >
              {TABS.map((tab) => {
                const active = tabId === tab;

                return (
                  <FilterChip
                    key={tab}
                    active={active}
                    onClick={() => handleTabChange(tab)}
                    className="group"
                  >
                    <span>
                      {tab === "all"
                        ? "All"
                        : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex min-w-4.5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:bg-background",
                      )}
                    >
                      {initialTabCounts[tab]}
                    </span>
                  </FilterChip>
                );
              })}
            </FilterChips>
          </div>
        }
      >
        {children}
      </TableCard>
    </div>
  );
}
