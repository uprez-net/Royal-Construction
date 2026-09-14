// Paging rules for the lead picker's infinite scroll (hooks/useLeadSearch.ts).
// Kept out of the hook so they can be tested without React.

/**
 * Folds a fetched page into the list already on screen. Page 1 is a fresh
 * result set (a new search, or the first load), so it replaces the list; any
 * later page appends, skipping leads already shown in case a lead moved
 * between pages while the user was scrolling.
 */
export function mergeLeadPage<T extends { id: number }>(
  prev: T[],
  incoming: T[],
  page: number,
): T[] {
  if (page <= 1) return incoming;
  const shown = new Set(prev.map((lead) => lead.id));
  return [...prev, ...incoming.filter((lead) => !shown.has(lead.id))];
}

/**
 * The page to request after the search text changes. A different search has to
 * start again from page 1: keeping the scrolled-to page asked for page 3 of the
 * new results and appended it to the old query's leads. The request trims the
 * text, so whitespace-only edits keep the current page.
 */
export function pageAfterQueryChange(
  prevQuery: string,
  nextQuery: string,
  page: number,
): number {
  return prevQuery.trim() === nextQuery.trim() ? page : 1;
}

/**
 * The chosen lead, but only while its card is on screen. A new search can hide
 * the chosen lead without clearing the choice, and confirming then opened a
 * lead the user could no longer see (the offer workspace creates its Offer row
 * on load). The skeleton hides every card while page 1 loads, so nothing
 * counts as chosen then either.
 */
export function shownSelection(
  selectedId: number | null,
  items: { id: number }[],
  loading: boolean,
): number | null {
  if (selectedId === null || loading) return null;
  return items.some((lead) => lead.id === selectedId) ? selectedId : null;
}
