import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  OFFER_LISTING_LEAD_FIELDS,
  offerListingLeadChanged,
} from "../../lib/offer/offer-listing-query";

// Reassigning a lead never expired the cached offers listing, which is scoped
// to the leads a user is assigned. The lead stayed on its old owner's offers
// list, and off its new owner's, until the cache ran out. The listing also
// shows the lead's name, contact details, location and type, and editing those
// never expired it either. updateLead lives in a module that loads Prisma, so
// no test can import it; this reads the source instead.
// updateTag would be the wrong fix: updateLead also runs from Route Handlers
// (the lead PATCH, MCP and booking routes), where updateTag throws.

const text = readFileSync(join(process.cwd(), "lib/data/leads.ts"), "utf8");
const listing = readFileSync(join(process.cwd(), "lib/data/offer-listing.ts"), "utf8");

// A top-level function runs from its signature to the first unindented `}`.
function functionBody(name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in leads.ts`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return text.slice(start, end);
}

test("updateLead expires the offers listing once the write is committed", () => {
  assert.match(text, /import \{[^}]*\brevalidateTag\b[^}]*\} from "next\/cache"/);
  const body = functionBody("updateLead");

  const invalidation = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(invalidation >= 0, "updateLead never invalidates the offers listing");
  assert.ok(
    body.indexOf("prisma.$transaction(") < invalidation,
    "the listing is expired before the lead is written",
  );
  assert.match(
    body,
    /if \(assigneeChanged \|\| listedFieldsChanged\) \{\s*revalidateTag\(\s*"offers"/,
  );
});

test("the invalidation is keyed off a real change of assignee", () => {
  const body = functionBody("updateLead");
  assert.match(
    body,
    /const assigneeChanged =\s*input\.assignedId !== undefined &&[^;]*existingLead\?\.assignedId/,
  );
});

test("and off a real change to a lead column the listing shows", () => {
  const body = functionBody("updateLead");
  assert.match(
    body,
    /const listedFieldsChanged = offerListingLeadChanged\(existingLead, updateData\);/,
  );
  // updateData is what is about to be stored, so it has to be complete first:
  // the check compares stored values, not the raw input.
  assert.ok(
    body.lastIndexOf("updateData.") < body.indexOf("const listedFieldsChanged"),
    "the change is measured before every field has been written into updateData",
  );
});

test("the fields checked are exactly the lead columns the listing selects", () => {
  const query = listing.indexOf("prisma.lead.findMany({");
  assert.ok(query >= 0, "the listing's lead query was not found");
  const select = listing.slice(
    listing.indexOf("select: {", query),
    listing.indexOf("offers: {", query),
  );
  const selected = [...select.matchAll(/(\w+): true/g)]
    .map((match) => match[1])
    .filter((field) => field !== "id");
  assert.deepEqual([...selected].sort(), [...OFFER_LISTING_LEAD_FIELDS].sort());
});

test("a write changes the listing only when a listed value differs", () => {
  const current = {
    name: "Ann Lee",
    email: "ann@example.com",
    phone: "0400000000",
    location: "Parramatta",
    type: ["Duplex"],
  };
  const unrelated: Record<string, unknown> = { notes: "called back", stage: "WON" };

  assert.equal(offerListingLeadChanged(current, {}), false);
  assert.equal(offerListingLeadChanged(current, unrelated), false);
  assert.equal(offerListingLeadChanged(current, { name: "Ann Lee", type: ["Duplex"] }), false);

  assert.equal(offerListingLeadChanged(current, { phone: "0411111111" }), true);
  assert.equal(offerListingLeadChanged(current, { location: "" }), true);
  assert.equal(offerListingLeadChanged(current, { type: ["Duplex", "Granny flat"] }), true);
  assert.equal(offerListingLeadChanged(current, { type: ["Granny flat"] }), true);
  assert.equal(offerListingLeadChanged(null, { email: "ann@example.com" }), true);
});

test("updateLead does not use updateTag, which throws outside a Server Action", () => {
  assert.doesNotMatch(functionBody("updateLead"), /\bupdateTag\(/);
});
