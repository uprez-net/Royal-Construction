import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  getOfferInputSchema,
  getOfferDetailsInputSchema,
  listOfferRevisionsInputSchema,
  searchOffersInputSchema,
  updateOfferDetailsInputSchema,
} from "../../agent/lib/offer-contracts";

test("offer tool inputs require exact bounded identifiers", () => {
  assert.equal(searchOffersInputSchema.safeParse({ query: "a" }).success, false);
  assert.equal(getOfferInputSchema.safeParse({ offerId: "not-a-uuid" }).success, false);
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
  const source = await readFile("agent/lib/offer-operations.ts", "utf8");
  assert.match(source, /requireCurrentAgentActor/);
  assert.match(source, /assertCanAccessLead/);
  assert.match(source, /leadListScope/);
  assert.doesNotMatch(source, /clerkId\s*:/);
});

test("offer results never expose workspace or document bodies", async () => {
  const source = await readFile("agent/lib/offer-operations.ts", "utf8");
  assert.match(source, /workspaceState: true/);
  assert.doesNotMatch(source, /workspaceState:\s*offer\.workspaceState/);
  assert.doesNotMatch(source, /agreedSnapshot:\s*true/);
  assert.doesNotMatch(source, /offerFiles:\s*true/);
});
