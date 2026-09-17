import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  completedEventNote,
  legacyCompletedEventNote,
  unexpectedCompletionNote,
  unexpectedDeclineNote,
} from "../../lib/docusign/completion-classifier";
import {
  formatActivityNote,
  formatActivityWhen,
} from "../../lib/offer/activity-format";

// Pins the negotiation timeline's timestamps. They never carried a year, so a
// send or reply from last year read as this year's. Mid-year instants keep the
// year and month the same in every timezone the suite might run in; the day of
// month does not, so the tests never assert on it.

const NOW = new Date("2026-09-15T02:00:00Z");

test("a date in the current year leaves the year off", () => {
  const when = formatActivityWhen("2026-06-10T03:00:00Z", NOW);

  assert.doesNotMatch(when, /2026/);
  assert.match(when, /Jun/);
});

test("REGRESSION: a date from a prior year shows its year", () => {
  const when = formatActivityWhen("2025-06-10T03:00:00Z", NOW);

  assert.match(when, /2025/);
});

// The DocuSign webhook's status-event notes lead with the machine prefix a
// redelivery dedups on, and the timeline printed them raw ("UNEXPECTED_DECLINE
// 3f2a…: DocuSign reports…"). The notes here come from the webhook's own
// builders, so a change to what is stored breaks these tests rather than the
// timeline.
const ENVELOPE = "3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f";

test("REGRESSION: a completed envelope reads as signed, with the id aside", () => {
  assert.deepEqual(formatActivityNote(completedEventNote(ENVELOPE)), {
    text: "Signed in DocuSign",
    envelopeId: ENVELOPE,
  });
});

test("a signature over a withdrawn envelope says it was kept aside", () => {
  assert.deepEqual(formatActivityNote(unexpectedCompletionNote(ENVELOPE, "Tender")), {
    text: "Tender signed after it was withdrawn — kept aside, not filed as the signed copy",
    envelopeId: ENVELOPE,
  });
});

test("a decline over a withdrawn envelope says so", () => {
  assert.deepEqual(formatActivityNote(unexpectedDeclineNote(ENVELOPE, "Contract")), {
    text: "Contract declined after it was withdrawn",
    envelopeId: ENVELOPE,
  });
});

// These events are filed under the offer's current status, so an old Tender
// declined once the Contract was drafted read as "Contract draft — Declined
// after it was withdrawn", as if the Contract had been declined.
test("REGRESSION: a withdrawn-envelope entry names the document it was", () => {
  for (const document of ["Offer acceptance", "Tender", "Contract"]) {
    assert.ok(
      formatActivityNote(unexpectedDeclineNote(ENVELOPE, document)).text.startsWith(
        `${document} declined`,
      ),
    );
    assert.ok(
      formatActivityNote(unexpectedCompletionNote(ENVELOPE, document)).text.startsWith(
        `${document} signed`,
      ),
    );
  }
});

test("a withdrawn-envelope note in another wording still reads as a sentence", () => {
  assert.deepEqual(formatActivityNote(`UNEXPECTED_DECLINE ${ENVELOPE}`), {
    text: "Declined after it was withdrawn",
    envelopeId: ENVELOPE,
  });
});

test("every other note passes through unchanged", () => {
  for (const note of [
    legacyCompletedEventNote(ENVELOPE),
    `DocuSign envelope ${ENVELOPE} sent to owner1@example.com`,
    "Declined via DocuSign: the price is too high",
    "DOCUSIGN_COMPLETEDX 123: not a webhook prefix",
  ]) {
    assert.deepEqual(formatActivityNote(note), { text: note, envelopeId: null });
  }
});

test("the timeline formats event notes instead of printing them raw", () => {
  const panel = readFileSync(
    join(process.cwd(), "components/offers/new-workflow/offer-workspace-activity.tsx"),
    "utf8",
  );

  assert.doesNotMatch(panel, /\$\{event\.note\}/);
  assert.match(panel, /formatActivityNote\(note\)/);
// The timeline used to decide whether a later reply existed by comparing two
// FORMATTED labels. This is why that was wrong: the formatter stops at the
// minute, so replies seconds apart are indistinguishable once formatted, and a
// client who wrote back twice in a minute had their latest reply hidden. The
// component compares the ISO instants now; this pins the property that forced
// it, so nobody reintroduces a label comparison.
test("two instants in the same minute format identically", () => {
  const now = new Date("2026-09-17T10:00:00+10:00");
  const first = formatActivityWhen("2026-09-17T09:30:05+10:00", now);
  const second = formatActivityWhen("2026-09-17T09:30:48+10:00", now);

  assert.equal(first, second);
  assert.notEqual("2026-09-17T09:30:05+10:00", "2026-09-17T09:30:48+10:00");
});
