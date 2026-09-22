import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectOwnerIssues,
  createCompanyOwner,
  createIndividualOwner,
  MAX_OWNER_SIGNERS,
  ownersFromLegacyClientFields,
  type OfferOwner,
} from "@/lib/offer/workspace-model";

function individual(
  id: string,
  name: string,
  email: string,
  currentLocation = "1 Test St, Sydney NSW 2000",
): OfferOwner {
  return {
    ...createIndividualOwner(id),
    displayName: name,
    currentLocation,
    signatories: [
      { id: `${id}-s`, name, email, phone: "", mobile: "", capacity: "Owner" },
    ],
  };
}

function company(
  id: string,
  name: string,
  directorEmail: string,
  abn = "12 345 678 901",
): OfferOwner {
  return {
    ...createCompanyOwner(id),
    displayName: name,
    abn,
    currentLocation: "10 Corporate Ave, Sydney NSW 2000",
    signatories: [
      {
        id: `${id}-d`,
        name: "Director One",
        email: directorEmail,
        phone: "",
        mobile: "",
        capacity: "Director",
      },
    ],
  };
}

test("complete individual owners produce no issues", () => {
  const owners = [
    individual("o1", "Radhika", "radhika@example.com"),
    individual("o2", "Jane", "jane@example.com"),
  ];
  assert.deepEqual(collectOwnerIssues(owners), []);
});

test("a company owner without an ABN/ACN is flagged (PR #124 P1)", () => {
  const owners = [company("c1", "Rakhi Pty Ltd", "dir@example.com", "")];
  const issues = collectOwnerIssues(owners);
  assert.ok(
    issues.some((i) => i.includes("Rakhi Pty Ltd") && i.includes("ABN")),
    `expected an ABN/ACN issue, got: ${JSON.stringify(issues)}`,
  );
});

test("a company owner with an ABN and a director produces no issues", () => {
  const owners = [company("c1", "Rakhi Pty Ltd", "dir@example.com")];
  assert.deepEqual(collectOwnerIssues(owners), []);
});

test("more than the signer cap is flagged (PR #124 review)", () => {
  const owners = Array.from({ length: MAX_OWNER_SIGNERS + 1 }, (_, i) =>
    individual(`o${i}`, `Owner ${i}`, `owner${i}@example.com`),
  );
  const issues = collectOwnerIssues(owners);
  assert.ok(
    issues.some((i) => i.includes("signatories") && i.includes("supported")),
    `expected a signer-cap issue, got: ${JSON.stringify(issues)}`,
  );
});

test("exactly the signer cap is allowed", () => {
  const owners = Array.from({ length: MAX_OWNER_SIGNERS }, (_, i) =>
    individual(`o${i}`, `Owner ${i}`, `owner${i}@example.com`),
  );
  assert.deepEqual(collectOwnerIssues(owners), []);
});

test("an individual owner is NOT asked for an ABN", () => {
  const issues = collectOwnerIssues([
    individual("o1", "Radhika", "radhika@example.com"),
  ]);
  assert.ok(!issues.some((i) => i.includes("ABN")));
});

test("two signers sharing an email is flagged (PR #124 P1)", () => {
  const owners = [
    individual("o1", "Radhika", "shared@example.com"),
    individual("o2", "Jane", "shared@example.com"),
  ];
  const issues = collectOwnerIssues(owners);
  assert.ok(
    issues.some(
      (i) => i.includes("shared@example.com") && i.includes("own email"),
    ),
    `expected a shared-email issue, got: ${JSON.stringify(issues)}`,
  );
});

test("an owner with zero signatories is flagged (PR #124 P2)", () => {
  const owner: OfferOwner = {
    ...createIndividualOwner("o1"),
    displayName: "Radhika",
    currentLocation: "1 Test St, Sydney NSW 2000",
    signatories: [],
  };
  const issues = collectOwnerIssues([owner]);
  assert.ok(
    issues.some((i) => i.includes("at least one")),
    `expected a zero-signatory issue, got: ${JSON.stringify(issues)}`,
  );
});

test("legacy migration does NOT fabricate a shared email for the co-owner (PR #124 P1)", () => {
  // A v1 offer with two named clients but only the primary email set.
  const owners = ownersFromLegacyClientFields({
    clientNames: "Radhika",
    secondaryCustomerName: "Rakesh",
    clientEmail: "radhika@example.com",
    secondaryCustomerEmail: "",
    clientPhone: "0400000000",
  });
  // Co-owner must be left blank (not seeded with the primary's email).
  assert.equal(owners[1].signatories[0].email, "");
  // And that surfaces as a "needs a valid email" issue, never a shared-email one.
  const issues = collectOwnerIssues(owners);
  assert.ok(issues.some((i) => i.includes("needs a valid email")));
  assert.ok(!issues.some((i) => i.includes("shared")));
});
