/**
 * Shared presentation for "which trade is this" chips, badges and avatars.
 *
 * Why there is no per-trade colour here
 * -------------------------------------
 * This replaces `randomColourHexGenerator(trade)`, which hashed a trade name into
 * a 10-entry *chart* palette. With 27 trades in the directory that guaranteed
 * collisions (~3 trades per colour), so the colour could never be a reliable
 * identity signal — and because the palette contained near-black (#0F172A) and
 * two greys, some trades rendered as unreadable text on an 8%-alpha tint of
 * themselves.
 *
 * In this design system colour means *status*: teal is action, amber is warning,
 * red is danger (see DESIGN.md §2). Spending 27 hues on trade identity would
 * compete with that vocabulary for no gain, because trade identity is already
 * carried by the icon each trade is given (TRADE_ICONS in constants/tradieTypes.ts).
 *
 * So: icon carries identity, neutral surface carries the chip, and colour stays
 * free to mean status. If per-trade or per-family colour is ever wanted, it
 * should be a deliberate design decision with a contrast-checked token ramp, not
 * a hash function.
 */

/** Chip/badge treatment for a trade label. Pair with the trade's lucide icon. */
export const TRADE_CHIP_CLASS =
  "gap-1 border-border/70 bg-muted text-foreground";

/** Square icon container (category cards, list rows). */
export const TRADE_ICON_TILE_CLASS =
  "flex items-center justify-center rounded-lg bg-muted text-muted-foreground";

/** Round initials avatar (tradie list rows, detail header). */
export const TRADE_AVATAR_CLASS =
  "flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground";
