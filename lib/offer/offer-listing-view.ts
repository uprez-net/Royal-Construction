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
