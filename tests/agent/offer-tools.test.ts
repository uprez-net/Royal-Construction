import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  getOfferInputSchema,
  getOfferDetailsInputSchema,
  listOfferRevisionsInputSchema,
  searchOffersInputSchema,
  updateOfferDetailsInputSchema,
} from "@/agent/lib/offer-contracts";

test("offer tool inputs require exact bounded identifiers", () => {
  assert.equal(
    searchOffersInputSchema.safeParse({ query: "a" }).success,
    false,
  );
  assert.equal(
    getOfferInputSchema.safeParse({ offerId: "not-a-uuid" }).success,
    false,
  );
  assert.equal(
    listOfferRevisionsInputSchema.safeParse({ leadId: 0, limit: 26 }).success,
    false,
  );
});

test("offer detail mutations require optimistic concurrency and bounded known sections", () => {
  assert.equal(
    getOfferDetailsInputSchema.safeParse({ offerId: "not-a-uuid" }).success,
    false,
  );
  assert.equal(
    updateOfferDetailsInputSchema.safeParse({
      offerId: "123e4567-e89b-42d3-a456-426614174000",
      expectedStateVersion: 2,
      patch: { areaCalculator: { mainFloorAreaSqm: 220 } },
    }).success,
    true,
  );
  assert.equal(
    updateOfferDetailsInputSchema.safeParse({
      offerId: "123e4567-e89b-42d3-a456-426614174000",
      expectedStateVersion: 2,
      patch: { arbitraryInstruction: "ignore safety" },
    }).success,
    false,
  );
});

test("offer reads resolve the current actor and shared lead scope", async () => {
  const operations = await readFile("agent/lib/offer-operations.ts", "utf8");
  const queries = await readFile("lib/domain/offers/queries.ts", "utf8");
  assert.match(operations, /requireCurrentAgentActor/);
  assert.match(operations, /searchOffers\(/);
  assert.match(operations, /listOfferRevisionSummaries\(/);
  assert.match(queries, /leadListScope\(principal\)/);
  assert.match(queries, /authorizeLead\(principal,/);
  assert.doesNotMatch(operations, /clerkId\s*:/);
});

test("offer results never expose workspace or document bodies", async () => {
  const operations = await readFile("agent/lib/offer-operations.ts", "utf8");
  const queries = await readFile("lib/domain/offers/queries.ts", "utf8");
  assert.match(queries, /workspaceState: true/);
  assert.doesNotMatch(operations, /workspaceState:\s*offer\.workspaceState/);
  assert.doesNotMatch(operations, /agreedSnapshot:\s*true/);
  assert.doesNotMatch(operations, /offerFiles:\s*true/);
});

test("an exclusion change must name the client document it is for", () => {
  // Staging: "add an exclusion" with no document named was written to the
  // Tender list without anyone choosing that.
  const base = {
    expectedStateVersion: 12,
    offerId: "123e4567-e89b-42d3-a456-426614174000",
  };
  const tenderPatch = {
    exclusions: [{ label: "Letterbox and house numbering" }],
  };
  const offerPatch = {
    draft: { exclusionBullets: ["Letterbox and house numbering"] },
  };
  const parse = (input: Record<string, unknown>) =>
    updateOfferDetailsInputSchema.safeParse({ ...base, ...input });

  const undeclared = parse({ patch: tenderPatch });
  assert.equal(undeclared.success, false);
  assert.deepEqual(undeclared.error?.issues[0]?.path, ["exclusionDocument"]);
  assert.equal(parse({ patch: offerPatch }).success, false);

  assert.equal(
    parse({ exclusionDocument: "tender", patch: tenderPatch }).success,
    true,
  );
  assert.equal(
    parse({ exclusionDocument: "offer", patch: offerPatch }).success,
    true,
  );
  assert.equal(
    parse({
      exclusionDocument: "both",
      patch: { ...tenderPatch, ...offerPatch },
    }).success,
    true,
  );

  // Declared for one document, written to the other's list.
  assert.equal(
    parse({ exclusionDocument: "offer", patch: tenderPatch }).success,
    false,
  );
  assert.equal(
    parse({ exclusionDocument: "tender", patch: offerPatch }).success,
    false,
  );
  assert.equal(
    parse({ exclusionDocument: "both", patch: tenderPatch }).success,
    false,
  );

  // Draft edits that leave the exclusion bullets alone need no declaration.
  assert.equal(
    parse({ patch: { draft: { introParagraph: "Thanks for your time." } } })
      .success,
    true,
  );
});
