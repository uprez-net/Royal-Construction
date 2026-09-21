/**
 * Deciding which row an assessing body's objection is about.
 *
 * A council rejects "the stormwater drawings"; the row on our file is called
 * "Hydraulic/stormwater drawings & design certificate". A certifier rejects
 * "item 7"; the row is a checklist line whose label is whatever they wrote on
 * the checklist three months ago. Neither name contains the other, and neither
 * body has any reason to use ours.
 *
 * A plain module rather than part of the data layer that calls it, for two
 * reasons that point the same way. The data layer is `"use server"` and may
 * export nothing but async functions, so none of this could be reached from a
 * test through it — and this is the part worth testing. It is also the only
 * genuinely uncertain step in the whole DA and checklist pipeline: everything
 * else is a row being written or a status being guarded, and this is a guess
 * with consequences.
 *
 * The bias throughout is towards not matching. A rejection landed on the wrong
 * row is worse than one landed on none: the row it hits goes back to
 * outstanding carrying an objection that is not about it, and the row it should
 * have hit still reads as accepted, so the thing the body actually refused is
 * the one thing nobody is looking at. An unmatched objection is reported, and
 * the message it came from is on the thread for somebody to read.
 */

/**
 * Words that appear in half the document names on a compliance file.
 *
 * Excluded from the distinctive-word pass, because matching on one of them is
 * matching on nothing: a council refusing "the amended plan" would otherwise
 * land on whichever row happens to have "plan" in its name first.
 */
const GENERIC: ReadonlySet<string> = new Set([
  "plan",
  "plans",
  "drawing",
  "drawings",
  "certificate",
  "certificates",
  "report",
  "reports",
  "document",
  "documents",
  "amended",
  "revised",
  "updated",
  "copy",
  "development",
  "application",
  "item",
  "items",
  "attached",
  "submitted",
  "provided",
]);

/**
 * A label reduced to what is actually being compared.
 *
 * Case, punctuation and trailing plurals go: a council writing "Shadow
 * Diagrams" in March and "shadow diagram" in April is naming one thing twice.
 *
 * The plural strip is deliberately narrow, and both of its guards earn their
 * keep. It needs four characters, so "gas" survives. And it refuses to strip an
 * "s" that follows another "s", so "access" and "address" survive — without
 * that, a lazy quantifier backtracks past the first of a double and turns
 * "access" into "acces", which then matches nothing it should.
 */
export function comparableName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(\w{2,}[^\Ws])s\b/g, "$1");
}

/** One row an objection might be about. */
export type RejectionCandidate = {
  id: string;
  /**
   * Every name this row goes by — the body's own wording where the row has
   * one, ours, and the bare type. All three are compared, because which of them
   * a sender uses is not predictable.
   */
  names: readonly string[];
  /**
   * Its position on the list it belongs to, where it is on one.
   *
   * The number a certifier means by "item 7". Null for a row that is not part
   * of a numbered list, which is every fixed document type.
   */
  order?: number | null;
};

/**
 * The row an objection is about, or null.
 *
 * Three passes, strongest first.
 *
 * 1. Substring, either direction. Most of these: "stormwater drawings" against
 *    "hydraulic stormwater drawings and design certificate".
 * 2. An explicit item number. A certifier refers to their own lines by number
 *    as often as by name, and "item 7 is not acceptable" carries no words worth
 *    matching at all.
 * 3. A shared distinctive word. For "amended stormwater plan" against
 *    "hydraulic/stormwater drawings", where neither contains the other and one
 *    word decides it — with the words half these names share excluded, or the
 *    pass would match everything.
 *
 * A pass that finds more than one candidate finds nothing. Two rows that both
 * look like the answer mean the objection has not been identified, and picking
 * the first is picking at random.
 */
export function matchRejection(
  documentName: string,
  candidates: readonly RejectionCandidate[],
): string | null {
  const wanted = comparableName(documentName);
  if (!wanted) return null;

  const bySubstring = candidates.filter((candidate) =>
    candidate.names.some(
      (name) =>
        name.length > 0 && (name.includes(wanted) || wanted.includes(name)),
    ),
  );
  if (bySubstring.length === 1) return bySubstring[0].id;
  if (bySubstring.length > 1) return null;

  const numbered = /\b(?:item|line|point|no|number)\s*(\d{1,2})\b/.exec(wanted);
  if (numbered) {
    const target = Number(numbered[1]);
    const byOrder = candidates.filter(
      (candidate) => candidate.order != null && candidate.order === target,
    );
    if (byOrder.length === 1) return byOrder[0].id;
    if (byOrder.length > 1) return null;
  }

  const wantedWords = new Set(
    wanted.split(" ").filter((word) => word.length > 3 && !GENERIC.has(word)),
  );
  if (wantedWords.size === 0) return null;

  const byWord = candidates.filter((candidate) =>
    candidate.names.some((name) =>
      name.split(" ").some((word) => wantedWords.has(word)),
    ),
  );
  return byWord.length === 1 ? byWord[0].id : null;
}
