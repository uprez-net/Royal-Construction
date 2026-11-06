import assert from "node:assert/strict";

import { describe, test } from "vitest";

import type { VariationDocumentData } from "@/lib/domain/ports/variation";
import { buildVariationDocumentHtml } from "@/lib/projects/variation-document-html";

// The document the client receives. What it must say is the expensive part:
// the old price struck through beside the new one, the reason in their own
// words, and what they owe — which is nothing when the builder covers it.

const base: VariationDocumentData = {
  absorbedCents: 0,
  activityName: "Roof framing",
  chargeExGstCents: 150_000,
  chargeIncGstCents: 165_000,
  clientNames: "Jane Smith & John Smith",
  differenceCents: 150_000,
  dueDate: new Date("2026-11-15T00:00:00.000Z"),
  greetingName: "Jane Smith",
  gstCents: 15_000,
  invoiceNumber: "INV-0042",
  kind: "CHARGEABLE",
  newPriceCents: 1_250_000,
  number: "V-003",
  previousPriceCents: 1_100_000,
  projectName: "Smith Residence",
  raisedDate: new Date("2026-11-01T00:00:00.000Z"),
  reason: "Hipped roof <at the owners' request>.",
  siteAddress: "12 Smith St, Parramatta NSW",
  stageLabel: "Frame",
};

describe("variation document", () => {
  test("strikes the quoted price beside the new one and totals inc GST", () => {
    const html = buildVariationDocumentHtml(base);
    assert.match(
      html,
      /class="was">\$11,000\.00<\/span><span class="now">\$12,500\.00/,
    );
    assert.match(html, /\+\$1,500\.00/);
    assert.match(html, /GST \(10%\)/);
    assert.match(html, /class="big">\$1,650\.00/);
    assert.match(html, /INV-0042/);
    assert.match(html, /Variation V-003/);
    assert.match(html, /1 November 2026/);
  });

  test("escapes what the office typed", () => {
    const html = buildVariationDocumentHtml(base);
    assert.match(html, /Hipped roof &lt;at the owners' request&gt;\./);
    assert.doesNotMatch(html, /<at the owners/);
  });

  test("promotional: the new price is shown, and the client pays $0.00", () => {
    const html = buildVariationDocumentHtml({
      ...base,
      absorbedCents: 150_000,
      chargeExGstCents: 0,
      chargeIncGstCents: 0,
      dueDate: null,
      gstCents: 0,
      invoiceNumber: null,
      kind: "PROMOTIONAL",
    });
    assert.match(html, /Covered by Royal Constructions/);
    assert.match(html, /−\$1,500\.00/);
    assert.match(html, /class="big">\$0\.00/);
    assert.doesNotMatch(html, /GST \(10%\)/);
    assert.doesNotMatch(html, /Payment Due/);
  });
});
