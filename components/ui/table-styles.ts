// The Leads table's look (app/globals.css .leads-table and .table-card), shared
// by every other table: a sunk header band, 13px rows with hairlines between
// them, a muted hover, all on one flat card with the table running edge to
// edge. No "use client": loading.tsx skeletons import these on the server.
//
// Only the look is shared. The Leads table's fixed layout, ellipsis and column
// widths suit its columns; other tables keep their own.

/**
 * The card a table sits on when nothing else draws one. It scrolls sideways
 * when the table is wider than the card, and that also clips the corners; an
 * overflow-hidden here would cut wide columns off with no way to reach them.
 */
export const TABLE_SURFACE_CLASS =
  "overflow-x-auto rounded-xl bg-card shadow-sm ring-1 ring-foreground/4";

/** The <thead> band. */
export const TABLE_HEAD_ROW_CLASS = "bg-muted";

/** A header cell: 11px uppercase label, muted. Line height rides on the size. */
export const TABLE_HEAD_CELL_CLASS =
  "px-4 py-2.5 text-left align-middle text-[11px]/[1.4] font-semibold tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase";

/** A body row: a hairline above every row but the first. */
export const TABLE_ROW_CLASS =
  "border-t border-border transition-colors first:border-t-0";

/** The hover for a row that opens something. */
export const TABLE_ROW_HOVER_CLASS = "hover:bg-muted";

/** A body cell. */
export const TABLE_CELL_CLASS =
  "px-4 py-2.5 align-middle text-[13px]/[1.5] text-foreground";

/**
 * A Card (or SectionCard) holding a table flush, as the Leads table sits in its
 * card: from md up the card loses its bottom padding and the gap under its
 * header, and the content loses its padding, so the header band runs edge to
 * edge. Below md the padding stays, around the phone cards.
 */
export const FLUSH_TABLE_CARD_CLASS = "md:gap-0 md:pb-0";
export const FLUSH_TABLE_CONTENT_CLASS = "md:p-0";
