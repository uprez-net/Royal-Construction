import type { OfferStatusBucket } from "@/types/offer";

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
): boolean {
  return status === "all" && q.trim() === "";
}

export type OfferListFilters = {
  readonly status: OfferStatusBucket;
  readonly q: string;
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
  requested: { readonly status?: OfferStatusBucket; readonly q?: string },
): OfferListFilters {
  return {
    status: requested.status ?? current.status,
    q: requested.q ?? current.q,
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
    isDefaultOfferFilters(filters.status, filters.q) &&
    current.page === server.page &&
    current.limit === server.limit
  );
}

/**
 * Whether a lead update moves the lead to a different assignee. The offers list
 * is cached per assignee, so a reassignment has to expire it: the old owner must
 * stop seeing the lead and the new owner must start. updateLead trims the id and
 * stores a blank one as null, so the comparison does the same.
 */
export function changesLeadAssignee(
  requested: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (requested === undefined) return false;
  return (requested?.trim() || null) !== (current ?? null);
}
