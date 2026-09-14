import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allCustomersSigned,
  builderSignerState,
  findBuilderStatus,
  findSignerStatus,
  shouldApplySignerStatus,
  signerStateFromStatus,
  signerStatusesBelow,
  type OfferSignerStatus,
} from "../../lib/offer/signing-status";

function customer(
  email: string,
  status: OfferSignerStatus["status"],
  docType: OfferSignerStatus["docType"] = "TENDER",
): OfferSignerStatus {
  return {
    docType,
    role: "CUSTOMER",
    name: email.split("@")[0],
    email,
    status,
    signedAt: status === "SIGNED" ? "2026-07-27T00:00:00.000Z" : null,
    routingOrder: 1,
  };
}

function builder(
  status: OfferSignerStatus["status"],
  docType: OfferSignerStatus["docType"] = "TENDER",
): OfferSignerStatus {
  return {
    docType,
    role: "BUILDER",
    name: "Royal Constructions",
    email: "builder@royal.example",
    status,
    signedAt: status === "SIGNED" ? "2026-07-27T00:00:00.000Z" : null,
    routingOrder: 2,
  };
}

// ─── status → UI state ───

test("only SIGNED and DECLINED are terminal; the rest are still awaiting", () => {
  assert.equal(signerStateFromStatus("SIGNED"), "signed");
  assert.equal(signerStateFromStatus("DECLINED"), "declined");
  for (const pending of ["CREATED", "SENT", "DELIVERED"] as const) {
    assert.equal(signerStateFromStatus(pending), "awaiting");
  }
});

// ─── matching a signer to its persisted row ───

test("THE BUG: a signed customer no longer reads as awaiting (#121/#123)", () => {
  // The tracker hard-coded every customer to "awaiting", so it still said
  // "Awaiting signature" after they had signed. Matching by email must find the
  // persisted SIGNED row.
  const statuses = [customer("a@example.com", "SIGNED")];
  const found = findSignerStatus(statuses, "TENDER", "a@example.com");
  assert.ok(found, "signer status not found");
  assert.equal(signerStateFromStatus(found.status), "signed");
});

test("matching is case- and whitespace-insensitive", () => {
  const statuses = [customer("Owner@Example.com", "SIGNED")];
  assert.ok(findSignerStatus(statuses, "TENDER", "  owner@example.COM  "));
});

test("does not cross documents — a signed tender leaves the contract awaiting", () => {
  // Same person signs both documents; the tender being signed must not make the
  // contract row show as signed.
  const statuses = [customer("a@example.com", "SIGNED", "TENDER")];
  assert.equal(findSignerStatus(statuses, "CONTRACT", "a@example.com"), undefined);
});

test("never matches the builder row when looking up a customer", () => {
  const statuses = [builder("SIGNED")];
  assert.equal(
    findSignerStatus(statuses, "TENDER", "builder@royal.example"),
    undefined,
  );
});

test("an empty email matches nothing rather than the first row", () => {
  const statuses = [customer("a@example.com", "SIGNED")];
  assert.equal(findSignerStatus(statuses, "TENDER", ""), undefined);
  assert.equal(findSignerStatus(statuses, "TENDER", "   "), undefined);
});

test("an unsent envelope has no rows, so signers fall back to awaiting", () => {
  assert.equal(findSignerStatus([], "TENDER", "a@example.com"), undefined);
});

// ─── all-customers-signed ───

test("allCustomersSigned is false while ANY customer is outstanding", () => {
  const statuses = [
    customer("a@example.com", "SIGNED"),
    customer("b@example.com", "DELIVERED"),
  ];
  assert.equal(allCustomersSigned(statuses, "TENDER"), false);
});

test("allCustomersSigned is true only when every customer has signed", () => {
  const statuses = [
    customer("a@example.com", "SIGNED"),
    customer("b@example.com", "SIGNED"),
    builder("SENT"),
  ];
  assert.equal(allCustomersSigned(statuses, "TENDER"), true);
});

test("allCustomersSigned is false with no customer rows at all", () => {
  // Otherwise an unsent envelope would read as "everyone signed" and promote the
  // builder to awaiting.
  assert.equal(allCustomersSigned([], "TENDER"), false);
  assert.equal(allCustomersSigned([builder("SENT")], "TENDER"), false);
});

// ─── builder routing state (customer-first documents) ───

test("builder waits behind the customers until they have all signed", () => {
  const statuses = [
    customer("a@example.com", "SIGNED"),
    customer("b@example.com", "DELIVERED"),
    builder("SENT"),
  ];
  assert.equal(builderSignerState(statuses, "TENDER"), "waiting_for_prior");
});

test("builder becomes the awaited party once all customers have signed", () => {
  const statuses = [
    customer("a@example.com", "SIGNED"),
    customer("b@example.com", "SIGNED"),
    builder("DELIVERED"),
  ];
  assert.equal(builderSignerState(statuses, "TENDER"), "awaiting");
});

test("a signed builder shows as signed regardless of customer state", () => {
  const statuses = [customer("a@example.com", "SIGNED"), builder("SIGNED")];
  assert.equal(builderSignerState(statuses, "TENDER"), "signed");
});

test("a declined builder shows as declined", () => {
  const statuses = [customer("a@example.com", "SIGNED"), builder("DECLINED")];
  assert.equal(builderSignerState(statuses, "TENDER"), "declined");
});

test("before any envelope exists the builder is queued, not awaited", () => {
  assert.equal(builderSignerState([], "TENDER"), "waiting_for_prior");
});

test("findBuilderStatus is scoped to the document", () => {
  const statuses = [builder("SIGNED", "TENDER")];
  assert.ok(findBuilderStatus(statuses, "TENDER"));
  assert.equal(findBuilderStatus(statuses, "CONTRACT"), undefined);
});

// ─── the reported end-to-end scenario ───

test("two-customer tender: one signed, one not (the reported screenshot)", () => {
  // Exactly what was on screen: two customers on a tender, DocuSign reporting
  // recipient-completed for one. Previously BOTH showed "Awaiting signature".
  const statuses = [
    customer("nishaal@example.com", "SIGNED"),
    customer("dhrub@example.com", "DELIVERED"),
    builder("SENT"),
  ];
  const nishaal = findSignerStatus(statuses, "TENDER", "nishaal@example.com");
  const dhrub = findSignerStatus(statuses, "TENDER", "dhrub@example.com");
  assert.equal(signerStateFromStatus(nishaal!.status), "signed");
  assert.equal(signerStateFromStatus(dhrub!.status), "awaiting");
  assert.equal(builderSignerState(statuses, "TENDER"), "waiting_for_prior");
});

// ─── forward-only recipient status ───

// The Connect webhook wrote whatever status each delivery carried. DocuSign
// sends events out of order and redelivers after a failure, so a late
// "delivered" landing after "completed" put a signed customer back to awaiting.

test("a late delivered event never undoes a signature", () => {
  assert.equal(shouldApplySignerStatus("SIGNED", "DELIVERED"), false);
});

test("a declined recipient is not moved back to sent", () => {
  assert.equal(shouldApplySignerStatus("DECLINED", "SENT"), false);
});

test("a recipient moves forward into signed and declined", () => {
  assert.equal(shouldApplySignerStatus("SENT", "SIGNED"), true);
  assert.equal(shouldApplySignerStatus("DELIVERED", "DECLINED"), true);
});

test("a replayed signature is not applied twice", () => {
  // Applying it again would overwrite signedAt with the replay's time.
  assert.equal(shouldApplySignerStatus("SIGNED", "SIGNED"), false);
});

test("signed and declined are both terminal, so neither replaces the other", () => {
  assert.equal(shouldApplySignerStatus("SIGNED", "DECLINED"), false);
  assert.equal(shouldApplySignerStatus("DECLINED", "SIGNED"), false);
});

test("the webhook's where clause lists exactly the statuses below the next one", () => {
  assert.deepEqual(signerStatusesBelow("SIGNED"), ["CREATED", "SENT", "DELIVERED"]);
  assert.deepEqual(signerStatusesBelow("DELIVERED"), ["CREATED", "SENT"]);
  assert.deepEqual(signerStatusesBelow("CREATED"), []);
});
