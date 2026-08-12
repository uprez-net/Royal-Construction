import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferDocumentCanvas } from "../../components/offers/new-workflow/offer-document-canvas";
import {
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  type OfferInclusionEntry,
} from "../../lib/offer/workspace-model";

function render(inclusionSchedule: readonly OfferInclusionEntry[]): string {
  return renderToStaticMarkup(
    createElement(OfferDocumentCanvas, {
      customerPrice: {
        selectedContractValueIncGst: 850_000,
        hasManualOverride: false,
      } as never,
      draft: { ...INITIAL_OFFER_DRAFT, inclusionSchedule },
      exclusions: INITIAL_EXCLUSIONS,
      job: INITIAL_OFFER_JOB,
      onDraftChange: () => {},
    }),
  );
}

// REGRESSION: every editable field showed a scrollbar. Tailwind sets
// box-sizing: border-box but scrollHeight excludes borders, so assigning
// scrollHeight directly left each field 2px short of its own content and the
// browser answered with a scrollbar — on a page made almost entirely of fields.
test("every editable field hides overflow, so none can show a scrollbar", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);
  const textareas = html.match(/<textarea[^>]*>/g) ?? [];

  assert.ok(textareas.length > 10, "the canvas should be mostly editable text");
  for (const textarea of textareas) {
    assert.match(
      textarea,
      /overflow-hidden/,
      `editable field is missing overflow-hidden: ${textarea.slice(0, 120)}`,
    );
  }
});

// REGRESSION: the schedule used `md:grid-cols-2`, and a grid fills ROW-wise, so
// the left column read 1,3,5,7 and the right 2,4,6,8. Scanning down a column of
// a numbered contractual schedule therefore showed every OTHER item. CSS
// multi-column flows down then across, so the left column reads 1..n in order.
test("the inclusions schedule uses multi-column, not a row-filled grid", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);
  const ol = html.match(/<ol class="([^"]*)"/)?.[1] ?? "";

  assert.match(ol, /md:columns-2/, "should use CSS multi-column for the schedule");
  assert.doesNotMatch(
    ol,
    /grid-cols-2/,
    "a row-filled grid breaks the reading order of a numbered schedule",
  );
  assert.match(
    ol,
    /break-inside-avoid/,
    "an entry must not split across the column break",
  );
});

// REGRESSION: a featured item's short label was rendered twice — once in the
// "This price includes" block and again inline under its schedule row. The
// label is now stated once, where it prints.
test("a featured label appears exactly once on the canvas", () => {
  const label = "Uniquely identifiable short label";
  const html = render([
    { spec: "A contractual sentence about the thing.", summary: label },
    { spec: "Another inclusion with no label." },
  ]);
  const occurrences = html.split(label).length - 1;

  assert.equal(
    occurrences,
    1,
    `the short label should be stated once, found ${occurrences}`,
  );
});

// REGRESSION: editing a featured item's short label to "Minimalistic kitchen"
// left its schedule row still promising a "Custom shaker door kitchen" — two
// contradictory claims in one fixed-price contract. The schedule wording for a
// featured item is now editable in the same block as its label, so the two
// cannot be reworded independently without both being on screen.
test("a featured item exposes its schedule wording for editing beside the label", () => {
  const html = render([
    { spec: "Custom shaker door kitchen and pantry.", summary: "Luxury kitchen" },
  ]);

  assert.match(html, /aria-label="Featured inclusion 1 short label"/);
  assert.match(html, /aria-label="Featured inclusion 1 schedule wording"/);
  assert.match(
    html,
    /Custom shaker door kitchen and pantry\./,
    "the schedule sentence must be visible beside its label",
  );
});

// The offer document carries inclusions and exclusions, not cost-schedule task
// detail. Pulling task wording across produced rows with no category, which
// printed as "Miscellaneous" on the client's contract.
test("the canvas offers no way to pull cost-schedule wording", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);

  assert.doesNotMatch(html, /Pull wording from cost schedule/);
});

test("an unfeatured entry offers a star and contributes nothing to page 4", () => {
  const html = render([{ spec: "Schedule only." }]);

  assert.match(html, /Feature inclusion 1 beside the price/);
  assert.match(html, /Nothing featured yet/);
});

test("a featured entry's label is editable where it prints", () => {
  const html = render([{ spec: "Spec.", summary: "Short label" }]);

  assert.match(
    html,
    /aria-label="Featured inclusion 1 short label"/,
    "the price-page label must be an editable field, not static text",
  );
  assert.match(html, /Stop featuring inclusion 1 beside the price/);
});
