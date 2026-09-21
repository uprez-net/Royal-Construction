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

// Issue #301 split this across two files, deliberately. Deciding that a listed
// column changed is a rule every caller needs, so it lives in the domain
// command; expiring a Next cache tag is something only a request can do, so it
// stays in the adapter. Both halves are checked.
const text = readFileSync(join(process.cwd(), "lib/data/leads.ts"), "utf8");
const command = readFileSync(
  join(process.cwd(), "lib/domain/leads/commands.ts"),
  "utf8",
);
const listing = readFileSync(
  join(process.cwd(), "lib/data/offer-listing.ts"),
  "utf8",
);

function bodyOf(source: string, name: string, where: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${where}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return source.slice(start, end);
}

const adapterBody = () => bodyOf(text, "updateLead", "lib/data/leads.ts");
const commandBody = () =>
  bodyOf(command, "updateLead", "lib/domain/leads/commands.ts");

function functionBody(name: string): string {
  return bodyOf(command, name, "lib/domain/leads/commands.ts");
}

test("updateLead expires the offers listing once the write is committed", () => {
  assert.match(
    text,
    /import \{[^}]*\brevalidateTag\b[^}]*\} from "next\/cache"/,
  );
  const body = adapterBody();

  const invalidation = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(
    invalidation >= 0,
    "updateLead never invalidates the offers listing",
  );
  // The command owns the transaction, so the expiry lands after it returns.
  assert.ok(
    body.indexOf("updateLeadDomain(") < invalidation,
    "the listing is expired before the lead is written",
  );
  // Union of both triggers: the assignee side is unconditional on being SET
  // (a pre-transaction compare could skip an expiry it owed), the listed-field
  // side compares what is about to be stored.
  assert.match(
    body,
    /if \(input\.assignedId !== undefined \|\| outcome\.listedFieldsChanged\) \{/,
  );
});

test("and off a real change to a lead column the listing shows", () => {
  const body = commandBody();
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
  const unrelated: Record<string, unknown> = {
    notes: "called back",
    stage: "WON",
  };

  assert.equal(offerListingLeadChanged(current, {}), false);
  assert.equal(offerListingLeadChanged(current, unrelated), false);
  assert.equal(
    offerListingLeadChanged(current, { name: "Ann Lee", type: ["Duplex"] }),
    false,
  );

  assert.equal(offerListingLeadChanged(current, { phone: "0411111111" }), true);
  assert.equal(offerListingLeadChanged(current, { location: "" }), true);
  assert.equal(
    offerListingLeadChanged(current, { type: ["Duplex", "Granny flat"] }),
    true,
  );
  assert.equal(
    offerListingLeadChanged(current, { type: ["Granny flat"] }),
    true,
  );
  assert.equal(
    offerListingLeadChanged(null, { email: "ann@example.com" }),
    true,
  );
});

test("the expiry cannot fail the save", () => {
  const body = adapterBody();
  const at = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(at >= 0, "updateLead never expires the offers listing");
  assert.match(
    body.slice(Math.max(0, at - 260), at + 260),
    /try \{[\s\S]*revalidateTag\(\s*"offers"[\s\S]*catch/,
    "the expiry is not guarded, so a cache failure would fail the lead save",
  );
});

test("updateLead does not use updateTag, which throws outside a Server Action", () => {
  assert.doesNotMatch(functionBody("updateLead"), /\bupdateTag\(/);
});
test("updateLead does not use updateTag, which throws outside a Server Action", () => {
  assert.doesNotMatch(functionBody("updateLead"), /\bupdateTag\(/);
});

test("the expiry cannot fail the save", () => {
  const body = adapterBody();
  const at = body.search(/revalidateTag\(\s*"offers"/);
  assert.ok(at >= 0, "updateLead never expires the offers listing");
  assert.match(
    body.slice(Math.max(0, at - 200), at + 200),
    /try \{[\s\S]*revalidateTag\(\s*"offers"[\s\S]*catch/,
    "the expiry is not guarded, so a cache failure would fail the lead save",
  );
});
