import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolveAllowances,
  resolveDraft,
} from "@/lib/offer/admin-offer-prefill";
import {
  EMPTY_ADMIN_OFFER_CONTENT,
  type AdminOfferContent,
} from "@/types/admin-offer-content";
import {
  OFFER_EXCLUDES_BULLETS,
  STANDARD_INCLUSION_ENTRIES,
  STANDARD_INCLUSION_HIGHLIGHTS,
} from "@/lib/offer/workspace-proposal-content";

// resolveDraft used to spread the hardcoded constants FIRST and then append only
// those admin lines that did not already match one. Because the seed writes
// those same constants into the admin row, every line an admin could see was one
// the constants re-added unconditionally: deleting a line was a silent no-op,
// and correcting a line's wording printed BOTH versions on the customer's
// fixed-price contract.
//
// The admin's configured list is now authoritative. The constants remain as the
// fallback for an unpopulated install, so a missing admin row still cannot drop
// every exclusion from every offer.

function contentWith(
  offerContent: Partial<AdminOfferContent["offerContent"]>,
): AdminOfferContent {
  return {
    ...EMPTY_ADMIN_OFFER_CONTENT,
    offerContent: {
      ...EMPTY_ADMIN_OFFER_CONTENT.offerContent,
      ...offerContent,
    },
  };
}

// The seeded state: the admin row holds exactly the constants.
const seeded = [...OFFER_EXCLUDES_BULLETS];

test("deleting a seeded exclusion removes it from the printed draft", () => {
  const removed = seeded[0];
  const kept = seeded.slice(1);

  const draft = resolveDraft(contentWith({ exclusions: kept }));

  assert.equal(
    draft.exclusionBullets.includes(removed),
    false,
    "a deleted exclusion still printed — the delete was a no-op",
  );
  assert.deepEqual([...draft.exclusionBullets], kept);
});

test("editing a seeded exclusion prints one wording, not both", () => {
  const original = seeded[0];
  const corrected = `${original} (corrected)`;
  const edited = [corrected, ...seeded.slice(1)];

  const draft = resolveDraft(contentWith({ exclusions: edited }));

  assert.equal(
    draft.exclusionBullets.includes(original),
    false,
    "the superseded wording printed alongside the correction",
  );
  assert.equal(draft.exclusionBullets.includes(corrected), true);
  assert.equal(
    draft.exclusionBullets.length,
    seeded.length,
    "an edit changed the number of exclusions on the contract",
  );
});

test("an admin exclusion list is used verbatim, in order", () => {
  const custom = ["Only this one", "And this one"];
  const draft = resolveDraft(contentWith({ exclusions: custom }));
  assert.deepEqual([...draft.exclusionBullets], custom);
});

test("blank and whitespace-only admin lines are dropped, not printed", () => {
  const draft = resolveDraft(
    contentWith({ exclusions: ["Real exclusion", "   ", ""] }),
  );
  assert.deepEqual([...draft.exclusionBullets], ["Real exclusion"]);
});

test("an unpopulated admin row still falls back to the constants", () => {
  // The safety net: a fresh or unseeded install must never produce an offer with
  // no exclusions at all.
  const draft = resolveDraft(contentWith({ exclusions: [] }));
  assert.deepEqual([...draft.exclusionBullets], [...OFFER_EXCLUDES_BULLETS]);
});

test("a list of only blank lines falls back rather than printing nothing", () => {
  const draft = resolveDraft(contentWith({ exclusions: ["", "  "] }));
  assert.deepEqual([...draft.exclusionBullets], [...OFFER_EXCLUDES_BULLETS]);
});

test("inclusion highlights follow the same precedence", () => {
  const kept = [...STANDARD_INCLUSION_HIGHLIGHTS].slice(1);
  const draft = resolveDraft(contentWith({ inclusions: kept }));
  assert.deepEqual([...draft.inclusionHighlights], kept);

  const fallback = resolveDraft(contentWith({ inclusions: [] }));
  assert.deepEqual(
    [...fallback.inclusionHighlights],
    [...STANDARD_INCLUSION_HIGHLIGHTS],
  );
});

test("the inclusion schedule follows the same precedence", () => {
  const kept = [...STANDARD_INCLUSION_ENTRIES].slice(1).map((row) => ({
    spec: row.spec,
    category: row.category,
  }));
  const draft = resolveDraft(contentWith({ inclusionSchedule: kept }));
  assert.equal(draft.inclusionSchedule.length, kept.length);
  assert.deepEqual(
    draft.inclusionSchedule.map((row) => row.spec),
    kept.map((row) => row.spec),
  );

  const fallback = resolveDraft(contentWith({ inclusionSchedule: [] }));
  assert.equal(
    fallback.inclusionSchedule.length,
    STANDARD_INCLUSION_ENTRIES.length,
  );
});

test("a schedule row with a blank spec is dropped", () => {
  const draft = resolveDraft(
    contentWith({
      inclusionSchedule: [
        { spec: "Real spec", category: "Concrete" },
        { spec: "   ", category: "Nothing" },
      ],
    }),
  );
  assert.deepEqual(
    draft.inclusionSchedule.map((row) => row.spec),
    ["Real spec"],
  );
});

test("admin allowances start off the Offer document and on the Tender", () => {
  const allowances = resolveAllowances({
    ...EMPTY_ADMIN_OFFER_CONTENT,
    offerScope: {
      ...EMPTY_ADMIN_OFFER_CONTENT.offerScope,
      allowances: [
        {
          id: "kitchen",
          name: "Kitchen appliances",
          category: "package",
          amount: 8500,
          variationRule: "Selections above allowance become a variation.",
        },
      ],
    },
  });
  assert.equal(allowances.length, 1);
  assert.equal(allowances[0].includedInOfferDocument, false);
  assert.equal(allowances[0].includedInTender, true);
});
