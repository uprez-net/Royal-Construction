import { MilestoneStatus, type Prisma } from "@prisma/client";

// The pure half of a tradie request's rules, shared by the command
// (requests.ts) and the request wizard, so the picker never offers what the
// command will refuse.

/** One request is one email per tradie; these keep it a reviewable size. */
export const MAX_REQUEST_TRADIES = 10;
export const MAX_REQUEST_ACTIVITIES = 20;

/** Files one request email may carry. */
export const MAX_REQUEST_ATTACHMENTS = 10;
/**
 * Their combined size. Below the mailbox's own send limit (about 26 MB of file
 * content at Exchange's 35 MB default, `lib/graph/client.ts`) so a request is
 * refused on screen before it is written, and small enough that a tradie's
 * mail server takes it too.
 */
export const MAX_REQUEST_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * A project file that may go to a tradie with a request. An incident report is
 * internal to the office: it can be about another tradie.
 */
export function isRequestAttachable(file: {
  readonly incidentId: string | null;
}): boolean {
  return file.incidentId === null;
}

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
 * Every category a tradie works in, the primary first.
 *
 * `trades` is the list; a row from before it existed, or one a caller built
 * from `trade` alone, falls back to the single trade.
 */
export function tradieTrades(tradie: {
  readonly trade: string;
  readonly trades?: readonly string[] | null;
}): string[] {
  const listed = (tradie.trades ?? [])
    .map((trade) => trade.trim())
    .filter(Boolean);
  if (listed.length > 0) return listed;
  return tradie.trade.trim() ? [tradie.trade.trim()] : [];
}

/** May this tradie be asked for this trade? Any of their categories will do. */
export function tradieCoversTrade(
  tradie: {
    readonly trade: string;
    readonly trades?: readonly string[] | null;
  },
  trade: string,
): boolean {
  return tradieTradeLabel(tradie, trade) !== null;
}

/**
 * The trade as this tradie's entry spells it, or null when they are not listed
 * under it. A command names a trade with this, so "plumbing" typed by a caller
 * reaches the tradie's email as "Plumbing".
 */
export function tradieTradeLabel(
  tradie: {
    readonly trade: string;
    readonly trades?: readonly string[] | null;
  },
  trade: string,
): string | null {
  return tradieTrades(tradie).find((own) => sameTrade(own, trade)) ?? null;
}

/**
 * `tradieCoversTrade` as a query: the primary trade, compared as people type
 * it, or any listed category. `trades` holds labels as the trade list spells
 * them (`resolveTradeLabel`), so an exact `has` is enough there.
 */
export function tradieInTradeWhere(trade: string): Prisma.TradieWhereInput {
  return {
    OR: [
      { trade: { equals: trade.trim(), mode: "insensitive" } },
      { trades: { has: trade.trim() } },
    ],
  };
}

/**
 * The trade a booking is for.
 *
 * Its own `trade` — a tradie with several categories is booked for one of
 * them — and, for a row that predates that column, the tradie's.
 */
export function bookingTrade(booking: {
  readonly trade?: string | null;
  readonly tradie: { readonly trade: string };
}): string {
  return booking.trade?.trim() || booking.tradie.trade;
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
