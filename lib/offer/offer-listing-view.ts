import type { OfferStatusBucket } from "@/types/offer";
import type { LeadListSort } from "@/lib/leads/list-sort";

export const DEFAULT_OFFER_SORT: LeadListSort = "updatedAt-desc";

export const OFFER_SORT_OPTIONS: readonly {
  value: LeadListSort;
  label: string;
}[] = [
  { value: "updatedAt-desc", label: "Client updated, newest first" },
  { value: "updatedAt-asc", label: "Client updated, oldest first" },
  { value: "name-asc", label: "Client name A–Z" },
  { value: "name-desc", label: "Client name Z–A" },
  { value: "createdAt-desc", label: "Client created, newest first" },
  { value: "createdAt-asc", label: "Client created, oldest first" },
];

// Pure view rules for the offers table, shared by the store and the
// components. Browser-safe: no Prisma, no next/*.

/**
 * True when the table shows the unfiltered list, the same view the server
 * renders on first paint. Whitespace-only search counts as no search, because
 * the query trims it away.
 */
export function isDefaultOfferFilters(
  status: OfferStatusBucket,
  q: string,
  sort: LeadListSort = DEFAULT_OFFER_SORT,
): boolean {
  return status === "all" && q.trim() === "" && sort === DEFAULT_OFFER_SORT;
}

export type OfferListFilters = {
  readonly status: OfferStatusBucket;
  readonly q: string;
  readonly sort: LeadListSort;
};

/**
 * The filters a fetch asks for, applied over the current ones. A field the
 * fetch leaves out keeps its current value, so a page change can re-fetch
 * without redeclaring the tab and search. The store records this when the fetch
 * STARTS: if a server refresh lands while it is still loading, the store must
 * already describe the view the user asked for, not the one they left.
 */
export function filtersForRequest(
  current: OfferListFilters,
  requested: Partial<OfferListFilters>,
): OfferListFilters {
  return {
    status: requested.status ?? current.status,
    q: requested.q ?? current.q,
    sort: requested.sort ?? current.sort ?? DEFAULT_OFFER_SORT,
  };
}

/**
 * Whether the page the server just rendered is the page the user is on. The
 * server always renders the unfiltered first page, so it is the right view only
 * for an unfiltered list on that same page and page size. A user on page 3
 * keeps page 3 across a refresh or a Back navigation.
 */
export function shouldAdoptServerOffers(
  filters: OfferListFilters,
  current: { readonly page: number; readonly limit: number },
  server: { readonly page: number; readonly limit: number },
): boolean {
  return (
    isDefaultOfferFilters(filters.status, filters.q, filters.sort)
    && current.page === server.page
    && current.limit === server.limit
  );
}
