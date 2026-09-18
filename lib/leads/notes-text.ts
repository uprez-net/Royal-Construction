import { coerceLeadNotesDocument } from "@/lib/rich-text/lead-notes";

/**
 * Where a lead's sales notes actually live, resolved in one place.
 *
 * `Lead.notes` used to be the answer and no longer is. The Notes tab is a
 * composer: it writes the note to `LeadHistory` and clears both `notes` and
 * `notesDoc` on save, because "the note's permanent home is the history entry".
 * The consultation booking route then wrote its own agenda into the same
 * column. So the field is empty on any lead whose notes went through the
 * composer, and holds the last booking's agenda on any lead that was booked —
 * while the offer pre-fill, the dashboard, the agent prompt and the email
 * templates each read it as though it were the sales notes.
 *
 * Callers pass whatever they hold. History is optional: a caller that did not
 * load it still gets the column and the document.
 */

/**
 * Actions whose detail is a note someone wrote, not a system event.
 *
 * Exported as an array because a caller has to be able to ASK for these rows:
 * the fallback is worthless to a query that never loaded any history, and a
 * query cannot filter on a Set. Keep the two in step — `LEAD_NOTE_ACTIONS` is
 * what producers select with, `NOTE_ACTIONS` is what the resolver matches on.
 */
export const LEAD_NOTE_ACTIONS = ["Lead note saved", "NOTE"] as const;

const NOTE_ACTIONS = new Set(
  LEAD_NOTE_ACTIONS.map((action) => action.toLowerCase()),
);

/**
 * The Prisma `include` a caller needs for the history fallback to work.
 *
 * Only note rows, oldest first, which is the order `resolveLeadNotesText`
 * expects. Filtered rather than capped: a lead carries a handful of notes, and
 * a `take` would have to be paired with a reversal to mean "the most recent".
 */
export const LEAD_NOTES_HISTORY_INCLUDE = {
  // Spread, not the tuple itself: Prisma's `in` wants a mutable string[], and a
  // readonly tuple from `as const` is rejected.
  where: { action: { in: [...LEAD_NOTE_ACTIONS] } },
  orderBy: { actionDate: "asc" as const },
  select: { action: true, detail: true },
};

export interface LeadNotesSource {
  notes?: string | null;
  notesDoc?: unknown;
  history?: ReadonlyArray<{
    action?: string | null;
    detail?: string | null;
  }> | null;
}

export interface ResolveLeadNotesOptions {
  /**
   * How many note entries to fall back to. The most recent ones, kept in the
   * order they were written so a reader follows the conversation forwards.
   */
  maxHistoryEntries?: number;
}

export function resolveLeadNotesText(
  source: LeadNotesSource | null | undefined,
  options: ResolveLeadNotesOptions = {},
): string {
  if (!source) return "";

  const direct = source.notes?.trim();
  if (direct) return direct;

  const documentText = coerceLeadNotesDocument(
    source.notesDoc,
  ).plainText.trim();
  if (documentText) return documentText;

  const { maxHistoryEntries = 5 } = options;
  if (maxHistoryEntries <= 0) return "";

  const noteEntries = (source.history ?? []).filter((entry) => {
    const action = entry.action?.trim().toLowerCase() ?? "";
    return NOTE_ACTIONS.has(action) && Boolean(entry.detail?.trim());
  });

  return noteEntries
    .slice(-maxHistoryEntries)
    .map((entry) => entry.detail!.trim())
    .join("\n\n");
}

/** `resolveLeadNotesText`, or `fallback` when the lead carries no notes at all. */
export function resolveLeadNotesTextOr(
  source: LeadNotesSource | null | undefined,
  fallback: string,
  options: ResolveLeadNotesOptions = {},
): string {
  return resolveLeadNotesText(source, options) || fallback;
}
