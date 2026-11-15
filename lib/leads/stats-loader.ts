/**
 * Loads the Leads cards for the timeframe the page is showing.
 *
 * Two things went wrong when this lived inline in the hook, and both are the
 * kind where the select says one thing and the cards another:
 *
 * - A caller that reloads without naming a timeframe (adding a lead from the
 *   Tasks tab reloads with Tasks' own parameters) overwrote the remembered one
 *   with `undefined` and put the cards back on all time. The timeframe is only
 *   ever replaced by a value, and a load without one reuses it.
 * - A full load and a refresh could resolve out of order, and the older one
 *   wrote its numbers last. Every load goes through here, and only the newest
 *   one's answer is returned; an older one gets null.
 */
export function createStatsLoader<T>(
  fetchOverview: (filterTiming?: string) => Promise<T>,
) {
  let timing: string | undefined;
  let latest = 0;

  return {
    /**
     * Resolves to the overview, or null when a newer load started while this
     * one was in flight. Rejects when the request fails.
     */
    async load(filterTiming?: string): Promise<T | null> {
      if (filterTiming !== undefined) timing = filterTiming;
      const mine = ++latest;
      const overview = await fetchOverview(timing);
      return mine === latest ? overview : null;
    },
  };
}
