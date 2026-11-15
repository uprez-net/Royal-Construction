/**
 * What the Leads table says when it has no rows.
 *
 * It used to say "No leads match your search." for every empty list, including
 * the ones emptied by the timeframe or a card with nothing typed in the box.
 * Names the thing that is actually narrowing the list.
 */
export function emptyLeadsMessage({
  hasSearch,
  hasFilters,
}: {
  hasSearch: boolean;
  /** A card or chip, or a timeframe other than all time. */
  hasFilters: boolean;
}): string {
  if (hasSearch && hasFilters) return "No leads match your search and filters.";
  if (hasSearch) return "No leads match your search.";
  if (hasFilters) return "No leads match these filters.";
  return "There are no leads yet.";
}
