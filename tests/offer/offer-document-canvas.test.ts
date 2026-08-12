import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OfferDocumentCanvas } from "../../components/offers/new-workflow/offer-document-canvas";
import {
  INITIAL_COST_LINES,
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
      lines: INITIAL_COST_LINES,
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

test("the inclusions schedule lays out in two columns", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);

  assert.match(
    html,
    /<ol class="[^"]*md:grid-cols-2/,
    "the schedule should use the full width, not a single narrow column",
  );
});

// REGRESSION: a featured item's short label was rendered twice — once in the
// "This price includes" block and again inline under its schedule row — which
// read as duplicated content on a screen already dense with text. The label is
// now shown once, where it prints, and the schedule row carries only a star.
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

test("an unfeatured entry offers a star and contributes nothing to page 4", () => {
  const html = render([{ spec: "Schedule only." }]);

  assert.match(html, /Feature inclusion 1 beside the price/);
  assert.match(html, /Nothing featured yet/);
});

test("a featured entry's label is editable where it prints", () => {
  const html = render([{ spec: "Spec.", summary: "Short label" }]);

  assert.match(
    html,
    /aria-label="Featured inclusion 1"/,
    "the price-page label must be an editable field, not static text",
  );
  assert.match(html, /Stop featuring inclusion 1 beside the price/);
});
