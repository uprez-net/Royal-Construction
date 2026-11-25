import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";

/**
 * Dollar figures left in free text after the price moved (#589).
 *
 * A revision copies the workspace wholesale, and `revisions.ts` recomputes only
 * the numeric columns, so a sentence an editor typed with last revision's total
 * in it survives. One client was sent a headline total and an allowances page
 * that disagreed, and caught it. Nothing builds a price into those sentences,
 * so the only check that works is: does a figure in the text equal an EARLIER
 * revision's contract total, and not this one's?
 */

// An earlier total below this is more likely a coincidence with an ordinary
// allowance than a stale contract price.
const MIN_STALE_TOTAL = 10_000;
// A total printed to the dollar still matches the cents behind it.
const TOLERANCE = 1;

const FIGURE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;

/** Every `$` figure in the text, as a number. */
export function dollarFigures(text: string): number[] {
  return Array.from(text.matchAll(FIGURE), (match) =>
    Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`),
  );
}

export type StalePriceFinding = {
  /** Where it is, in words the office knows. */
  readonly field: string;
  readonly figure: number;
};

type TextField = { readonly field: string; readonly text: string };

function textFields(snapshot: OfferWorkspaceSnapshot): TextField[] {
  const fields: TextField[] = [
    { field: "Headline", text: snapshot.draft.headline },
    { field: "Intro text", text: snapshot.draft.introText },
    { field: "Terms summary", text: snapshot.draft.termsSummary },
    { field: "Price adjustment label", text: snapshot.priceAdjustmentLabel },
  ];
  snapshot.draft.inclusionHighlights.forEach((text, index) =>
    fields.push({ field: `Inclusion highlight ${index + 1}`, text }),
  );
  for (const allowance of snapshot.allowances) {
    const name = allowance.label.trim() || "Allowance";
    fields.push(
      { field: `Allowance "${name}" label`, text: allowance.label },
      { field: `Allowance "${name}" description`, text: allowance.description },
      {
        field: `Allowance "${name}" variation rule`,
        text: allowance.variationRule,
      },
    );
  }
  return fields;
}

/**
 * Figures in the offer's free text that match a superseded total but not a
 * current one. `current` wins: an unchanged price is not stale.
 */
export function findStalePriceText(
  snapshot: OfferWorkspaceSnapshot,
  superseded: readonly number[],
  current: readonly number[],
): StalePriceFinding[] {
  const near = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;
  const stale = superseded.filter(
    (total) =>
      total >= MIN_STALE_TOTAL && !current.some((now) => near(now, total)),
  );
  if (stale.length === 0) return [];

  return textFields(snapshot).flatMap(({ field, text }) =>
    dollarFigures(text)
      .filter((figure) => stale.some((total) => near(total, figure)))
      .map((figure) => ({ field, figure })),
  );
}

/** One sentence for the office, naming each field to fix. */
export function describeStalePriceText(
  findings: readonly StalePriceFinding[],
): string {
  const list = findings
    .map(
      ({ field, figure }) =>
        `${field} ($${figure.toLocaleString("en-AU", { maximumFractionDigits: 2 })})`,
    )
    .join("; ");
  return `Text in this offer still quotes an earlier revision's total: ${list}. Update it before sending.`;
}
