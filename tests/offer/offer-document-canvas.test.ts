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
      draft: {
        ...INITIAL_OFFER_DRAFT,
        inclusionHighlights: ["A selling line"],
        inclusionSchedule,
      },
      exclusions: INITIAL_EXCLUSIONS,
      job: INITIAL_OFFER_JOB,
      onDraftChange: () => {},
    }),
  );
}

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

test("the inclusions schedule uses multi-column, not a row-filled grid", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);
  const ol = html.match(/<ol class="([^"]*)"/)?.[1] ?? "";

  assert.match(
    ol,
    /md:columns-2/,
    "should use CSS multi-column for the schedule",
  );
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

test("the price block edits the highlight list, not per-row labels", () => {
  const html = render([{ spec: "A contractual sentence." }]);

  assert.match(html, /aria-label="Highlight 1"/);
  assert.doesNotMatch(html, /Feature inclusion 1 beside the price/);
  assert.doesNotMatch(html, /short label/);
});

// Contract text the model wrote must stay visibly marked in the schedule.
test("an AI-drafted schedule row is marked", () => {
  const html = render([{ spec: "Drafted wording.", draftedByAi: true }]);

  assert.match(html, /AI draft/);
});

test("a human-written row carries no marker", () => {
  const html = render([{ spec: "Mine." }]);

  assert.doesNotMatch(html, /AI draft/);
});

// Keyboard focus on a canvas field only tinted its border to 60% gold, about
// 1.8:1 against the white field, so tabbing through the document showed no
// usable indicator. The ink border (5.37:1) plus a ring is a visible one.
test("every editable field focuses to the ink border, not the faint gold", () => {
  const html = render(INITIAL_OFFER_DRAFT.inclusionSchedule);
  const textareas = html.match(/<textarea[^>]*>/g) ?? [];

  assert.ok(textareas.length > 10, "the canvas should be mostly editable text");
  for (const textarea of textareas) {
    assert.match(
      textarea,
      /focus:border-royal-gold-ink(?![\w-])/,
      `editable field has no ink focus border: ${textarea.slice(0, 120)}`,
    );
    assert.doesNotMatch(textarea, /royal-gold\/60/);
  }
});
