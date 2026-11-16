import assert from "node:assert/strict";
import { test } from "vitest";

import { describeOfferEditability } from "@/lib/offer/offer-editability";

// Eve read an issued offer and could not say it was locked, so it asked for an
// approval the server then refused (#366). The read now carries the answer.

test("a pending offer accepts price, scope and document edits", () => {
  const out = describeOfferEditability("pending");
  assert.equal(out.canEditPriceInputs, true);
  assert.equal(out.canEditScopeAndDocument, true);
  assert.equal(out.lockedReason, null);
});

test("a sent offer keeps scope and document editable but freezes the price inputs", () => {
  const out = describeOfferEditability("sent");
  assert.equal(out.canEditPriceInputs, false);
  assert.equal(out.canEditScopeAndDocument, true);
  assert.equal(out.lockedReason, null);
});

test("an offer out for tender signature is locked, with the reason the write gives", () => {
  const out = describeOfferEditability("tender_sent");
  assert.equal(out.canEditPriceInputs, false);
  assert.equal(out.canEditScopeAndDocument, false);
  assert.match(out.lockedReason ?? "", /Issued offer details are locked/);
});

test("every status after the negotiation window is locked for scope", () => {
  for (const status of [
    "offer_sent",
    "offer_signed",
    "agreed",
    "tender_sent",
    "contract_sent",
    "project",
  ] as const) {
    assert.equal(
      describeOfferEditability(status).canEditScopeAndDocument,
      false,
      status,
    );
  }
});
