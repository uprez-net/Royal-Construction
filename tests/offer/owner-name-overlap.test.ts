import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "vitest";

import type { DomainDb } from "@/lib/domain/db";
import { generateOfferPrefill } from "@/lib/domain/offers/prefill";
import { userPrincipal } from "@/lib/domain/principal";
import {
  collectOwnerIssues,
  createCompanyOwner,
  createIndividualOwner,
  findOverlappingOwnerNames,
  formatOwnerGreetingNames,
  splitCombinedOwnerName,
  type OfferOwner,
} from "@/lib/offer/workspace-model";

// Issue #344: offer 105 printed "Harpreet & Manpreet Sandhu & Manpreet Sandhu"
// on the cover, and "I/We, Harpreet & Manpreet Sandhu and Manpreet Sandhu,
// accept this proposal" above the signatures.

function individual(id: string, name: string, email: string): OfferOwner {
  return {
    ...createIndividualOwner(id),
    displayName: name,
    currentLocation: "1 Test St, Kellyville NSW 2155",
    signatories: [
      { id: `${id}-s`, name, email, phone: "", mobile: "", capacity: "Owner" },
    ],
  };
}

test("a combined name carries its shared surname onto each person", () => {
  assert.deepEqual(splitCombinedOwnerName("Harpreet & Manpreet Sandhu"), [
    "Harpreet Sandhu",
    "Manpreet Sandhu",
  ]);
  assert.deepEqual(
    splitCombinedOwnerName("Harpreet Sandhu and Manpreet Kaur"),
    ["Harpreet Sandhu", "Manpreet Kaur"],
  );
  assert.equal(splitCombinedOwnerName("Manpreet Sandhu"), null);
  assert.equal(splitCombinedOwnerName("Mr & Mrs Sandhu"), null);
  assert.equal(splitCombinedOwnerName("Sandra Anderson"), null);
});

test("a bare name between two families keeps no surname rather than a guessed one", () => {
  assert.deepEqual(
    splitCombinedOwnerName("Harpreet Sandhu & Manpreet & Jaspreet Kaur"),
    ["Harpreet Sandhu", "Manpreet", "Jaspreet Kaur"],
  );
  assert.deepEqual(
    splitCombinedOwnerName("Harpreet & Manpreet & Jaspreet Sandhu"),
    ["Harpreet Sandhu", "Manpreet Sandhu", "Jaspreet Sandhu"],
  );
  // So a Manpreet Kaur listed separately is not mistaken for this Manpreet.
  const owners = [
    individual(
      "o1",
      "Harpreet Sandhu & Manpreet & Jaspreet Kaur",
      "h@example.com",
    ),
    individual("o2", "Manpreet Kaur", "m@example.com"),
  ];
  assert.deepEqual(findOverlappingOwnerNames(owners), []);
});

test("two combined owners sharing one person are caught, once", () => {
  const owners = [
    individual("o1", "Harpreet & Manpreet Sandhu", "h@example.com"),
    individual("o2", "Manpreet & Jaspreet Sandhu", "j@example.com"),
    individual("o3", "Manpreet Sandhu", "m@example.com"),
  ];
  assert.deepEqual(findOverlappingOwnerNames(owners), [
    {
      combinedName: "Harpreet & Manpreet Sandhu",
      otherName: "Manpreet & Jaspreet Sandhu",
      personName: "Manpreet Sandhu",
    },
  ]);
  const issues = collectOwnerIssues(owners);
  assert.equal(issues.length, 1);
  assert.match(
    issues[0],
    /Manpreet Sandhu is named in both Harpreet & Manpreet Sandhu and Manpreet & Jaspreet Sandhu/,
  );
});

test("offer 105's owners are refused before any document reaches the client", () => {
  const owners = [
    individual("o1", "Harpreet & Manpreet Sandhu", "harpreet@example.com"),
    individual("o2", "Manpreet Sandhu", "manpreet@example.com"),
  ];
  assert.deepEqual(findOverlappingOwnerNames(owners), [
    {
      combinedName: "Harpreet & Manpreet Sandhu",
      otherName: "Manpreet Sandhu",
      personName: "Manpreet Sandhu",
    },
  ]);
  const issues = collectOwnerIssues(owners);
  assert.equal(issues.length, 1);
  assert.match(
    issues[0],
    /Harpreet & Manpreet Sandhu already names Manpreet Sandhu, who is also listed as a separate owner/,
  );
});

test("honorifics and case do not hide the overlap", () => {
  const owners = [
    individual("o1", "Mr & Mrs Harpreet & Manpreet Sandhu", "h@example.com"),
    individual("o2", "manpreet  sandhu", "m@example.com"),
  ];
  assert.equal(findOverlappingOwnerNames(owners).length, 1);
});

test("two separate owners with one name are two real people, not an overlap", () => {
  const owners = [
    individual("o1", "Manpreet Sandhu", "senior@example.com"),
    individual("o2", "Manpreet Sandhu", "junior@example.com"),
  ];
  assert.deepEqual(findOverlappingOwnerNames(owners), []);
  assert.deepEqual(collectOwnerIssues(owners), []);
});

test("distinct owners and company names are left alone", () => {
  const firm = {
    ...createCompanyOwner("o3"),
    displayName: "Sandhu & Manpreet Sandhu Pty Ltd",
  };
  const owners = [
    individual("o1", "Harpreet & Jaspreet Sandhu", "h@example.com"),
    individual("o2", "Manpreet Sandhu", "m@example.com"),
    firm,
  ];
  assert.deepEqual(findOverlappingOwnerNames(owners), []);
});

test("the greeting still strips a combined honorific", () => {
  assert.equal(
    formatOwnerGreetingNames([individual("o1", "Mr & Mrs Smith", "s@x.com")]),
    "Smith",
  );
});

function prefillDb(lead: {
  name: string;
  secondaryName: string | null;
}): DomainDb {
  const row = {
    assignedId: "user-1",
    budget: null,
    email: "harpreet@example.com",
    emails: [],
    history: [],
    id: 105,
    location: "Kellyville NSW 2155, Australia",
    notes: null,
    notesDoc: null,
    phone: null,
    secondaryEmail: "manpreet@example.com",
    type: [],
    ...lead,
  };
  return {
    lead: { findUnique: async () => row },
  } as unknown as DomainDb;
}

const ADMIN = userPrincipal({ id: "user-1", role: Role.ADMIN });
const noAi = async () => {
  throw new Error("no AI call expected: the lead has nothing to draft from");
};

test("pre-fill takes the secondary contact out of the combined lead name, and says so", async () => {
  const result = await generateOfferPrefill(
    ADMIN,
    105,
    prefillDb({
      name: "Harpreet & Manpreet Sandhu",
      secondaryName: "Manpreet Sandhu",
    }),
    noAi,
  );
  assert.ok(result.ok);
  const owners = result.job.owners ?? [];
  assert.deepEqual(
    owners.map((owner) => owner.displayName),
    ["Harpreet Sandhu", "Manpreet Sandhu"],
  );
  assert.equal(owners[0].signatories[0].name, "Harpreet Sandhu");
  assert.equal(result.job.clientNames, "Harpreet Sandhu");
  assert.deepEqual(findOverlappingOwnerNames(owners), []);
  assert.match(
    result.notes,
    /already includes the secondary contact Manpreet Sandhu/,
  );
});

test("pre-fill keeps a combined lead name whose secondary is someone else", async () => {
  const result = await generateOfferPrefill(
    ADMIN,
    105,
    prefillDb({
      name: "Harpreet & Manpreet Sandhu",
      secondaryName: "Jaspreet Kaur",
    }),
    noAi,
  );
  assert.ok(result.ok);
  assert.deepEqual(
    (result.job.owners ?? []).map((owner) => owner.displayName),
    ["Harpreet & Manpreet Sandhu", "Jaspreet Kaur"],
  );
  assert.doesNotMatch(result.notes, /secondary contact/);
});
