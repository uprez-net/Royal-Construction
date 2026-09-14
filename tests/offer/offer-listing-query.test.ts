import { test } from "node:test";
import assert from "node:assert/strict";

import { offerSearchClauses } from "../../lib/offer/offer-listing-query";

// The offers table shows each lead by its offer reference, but search only
// looked at the lead's name, email, phone and location. Pasting the reference
// a client quoted, or the OF-<id> the table shows, found nothing.

test("an offer reference searches the revisions' baseReference", () => {
  assert.ok(
    offerSearchClauses("RC-0042").some(
      (clause) =>
        JSON.stringify(clause) ===
        JSON.stringify({
          offers: {
            some: { baseReference: { contains: "RC-0042", mode: "insensitive" } },
          },
        }),
    ),
  );
});

test("the OF-<id> fallback reference matches the lead id, in any case", () => {
  assert.ok(
    offerSearchClauses("of-123").some(
      (clause) => JSON.stringify(clause) === JSON.stringify({ id: 123 }),
    ),
  );
});

test("a plain term searches the lead columns and references, not an id", () => {
  const clauses = offerSearchClauses("smith");
  assert.equal(clauses.length, 5);
  assert.ok(clauses.every((clause) => !("id" in clause)));
});

test("an OF- number too large for a lead id adds no id clause", () => {
  const clauses = offerSearchClauses("OF-99999999999");
  assert.equal(clauses.length, 5);
  assert.ok(clauses.every((clause) => !("id" in clause)));
});
