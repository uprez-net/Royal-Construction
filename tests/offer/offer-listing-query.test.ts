import assert from "node:assert/strict";
import { test } from "vitest";

import { offerSearchClauses } from "@/lib/offer/offer-listing-query";

// The offers table shows each lead by its offer reference, but search only
// looked at the lead's name, email, phone and location. Pasting the reference
// a client quoted, or the OF-<id> the table shows, found nothing. The quoted
// reference carries its revision ("RC-Q-2026-042-R2") while only the base is
// stored, so matching the base alone still missed it.

const hasClause = (clauses: unknown[], expected: unknown) =>
  clauses.some((clause) => JSON.stringify(clause) === JSON.stringify(expected));

test("a quoted revision reference matches its base on that revision", () => {
  for (const q of ["RC-Q-2026-042-R2", "rc-q-2026-042-r2"]) {
    assert.ok(
      hasClause(offerSearchClauses(q), {
        offers: {
          some: {
            baseReference: {
              contains: q.slice(0, "RC-Q-2026-042".length),
              mode: "insensitive",
            },
            revisionNumber: 2,
          },
        },
      }),
      q,
    );
  }
});

test("a bare -R<n> or an out-of-range revision adds no revision clause", () => {
  for (const q of ["-R2", "RC-Q-2026-042-R99999999999"]) {
    assert.ok(
      offerSearchClauses(q).every(
        (clause) => !JSON.stringify(clause).includes("revisionNumber"),
      ),
      q,
    );
  }
});

test("an offer reference searches the revisions' baseReference", () => {
  assert.ok(
    offerSearchClauses("RC-0042").some(
      (clause) =>
        JSON.stringify(clause)
        === JSON.stringify({
          offers: {
            some: {
              baseReference: { contains: "RC-0042", mode: "insensitive" },
            },
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
