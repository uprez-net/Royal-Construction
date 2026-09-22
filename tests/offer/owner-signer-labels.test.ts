import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectOfferSignerLabels,
  createCompanyOwner,
  createIndividualOwner,
  type OfferOwner,
} from "@/lib/offer/workspace-model";

// Regression for the tender/contract preview + signing-tracker bug: the UI
// rendered the legacy clientNames/secondaryCustomerName projection, so a company
// owner showed as a single "Customer — <company>" signer (capped at 2) instead of
// its directors — diverging from the DocuSign envelope, which correctly carries
// one recipient per individual owner and per director.

function rakhiCompany(): OfferOwner {
  const base = createCompanyOwner("owner-2");
  return {
    ...base,
    displayName: "Rakhi Pty Ltd",
    abn: "92345689",
    currentLocation: "224 Pacific Hwy, Crows Nest NSW 2065",
    signatories: [
      {
        id: "d1",
        name: "Raki",
        email: "director1@example.com",
        phone: "",
        mobile: "",
        capacity: "Director",
      },
      {
        id: "d2",
        name: "Pop",
        email: "director2@example.com",
        phone: "",
        mobile: "",
        capacity: "Director",
      },
    ],
  };
}

test("an individual + a company with two directors yields three signer labels", () => {
  const radhika: OfferOwner = {
    ...createIndividualOwner("owner-1"),
    displayName: "Radhika",
    signatories: [
      {
        id: "s1",
        name: "Radhika",
        email: "owner@example.com",
        phone: "0400000000",
        mobile: "",
        capacity: "Owner",
      },
    ],
  };

  const labels = collectOfferSignerLabels([radhika, rakhiCompany()]);

  // Every director signs — never the company as a single party (the old bug).
  assert.deepEqual(labels, [
    "Radhika",
    "Raki (Director, Rakhi Pty Ltd)",
    "Pop (Director, Rakhi Pty Ltd)",
  ]);
  // The legacy projection would have produced exactly two, with the company name
  // standing in for a signer.
  assert.notDeepEqual(labels, ["Radhika", "Rakhi Pty Ltd"]);
});

test("a single individual owner yields one plain label", () => {
  const solo: OfferOwner = {
    ...createIndividualOwner("owner-1"),
    displayName: "Jane Smith",
    signatories: [
      {
        id: "s1",
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "",
        mobile: "",
        capacity: "Owner",
      },
    ],
  };
  assert.deepEqual(collectOfferSignerLabels([solo]), ["Jane Smith"]);
});
