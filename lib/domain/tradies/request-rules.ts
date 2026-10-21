import { MilestoneStatus } from "@prisma/client";

// The pure half of a tradie request's rules, shared by the command
// (requests.ts) and the request wizard, so the picker never offers what the
// command will refuse.

/** One request is one email per tradie; these keep it a reviewable size. */
export const MAX_REQUEST_TRADIES = 10;
export const MAX_REQUEST_ACTIVITIES = 20;

/** Milestones nobody can still be asked to do. */
const CLOSED_MILESTONE_STATUSES: readonly MilestoneStatus[] = [
  MilestoneStatus.DONE,
  MilestoneStatus.NOT_REQUIRED,
];

/** A finished or waived activity cannot be requested. */
export function isRequestableMilestone(status: MilestoneStatus): boolean {
  return !CLOSED_MILESTONE_STATUSES.includes(status);
}

/**
 * Trade labels compare as people type them, ignoring case and edges.
 *
 * `Tradie.trade` holds the label rather than a key to `TradeType`, so this is
 * the only join there is between a tradie and the trade a milestone needs.
 */
export function sameTrade(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * May this trade be asked to do this activity? Yes when the build sequence
 * names no trade for it, or names this one among those it needs.
 */
export function activityAcceptsTrade(
  requiredTrades: readonly { label: string }[],
  trade: string,
): boolean {
  return (
    !requiredTrades.length
    || requiredTrades.some((required) => sameTrade(required.label, trade))
  );
}

/** "Plumbing", "Plumbing and Electrical", "Plumbing, Tiling and Electrical". */
export function tradeList(trades: readonly { label: string }[]): string {
  return new Intl.ListFormat("en-AU", { type: "conjunction" }).format(
    trades.map((trade) => trade.label),
  );
}
