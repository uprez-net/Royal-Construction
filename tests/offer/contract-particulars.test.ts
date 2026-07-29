import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTRACT_PARTICULAR_FIELDS,
  EMPTY_CONTRACT_PARTICULARS,
  contractParticularsToLockedTabs,
  deriveContractParticularDefaults,
  missingRecommendedParticulars,
  normalizeContractParticulars,
  parseContractParticularOverrides,
  parseContractParticulars,
  reconcileContractParticularDefaults,
  serializeContractParticulars,
  type ContractParticulars,
} from "../../lib/offer/contract-particulars";

test("parseContractParticulars returns the empty set for null/garbage", () => {
  assert.deepEqual(parseContractParticulars(null), EMPTY_CONTRACT_PARTICULARS);
  assert.deepEqual(
    parseContractParticulars(undefined),
    EMPTY_CONTRACT_PARTICULARS,
  );
  assert.deepEqual(
    parseContractParticulars("not an object"),
    EMPTY_CONTRACT_PARTICULARS,
  );
});

test("serialization ignores malformed client values instead of throwing", () => {
  const malformed = {
    ...EMPTY_CONTRACT_PARTICULARS,
    hbcfCost: 7528.52 as never,
  };
  const stored = serializeContractParticulars(malformed, ["hbcfCost"]);

  assert.equal(stored.hbcfCost, "");
  assert.deepEqual(parseContractParticularOverrides(stored), []);
});

test("parseContractParticulars keeps known keys and drops unknown ones", () => {
  const parsed = parseContractParticulars({
    hbcfCost: "$1,250",
    interestRate: "10% p.a.",
    bogusKey: "ignored",
  });
  assert.equal(parsed.hbcfCost, "$1,250");
  assert.equal(parsed.interestRate, "10% p.a.");
  assert.equal(parsed.ownerAddress, "");
  assert.equal(
    (parsed as Record<string, unknown>).bogusKey,
    undefined,
    "unknown keys are stripped",
  );
});

test("normalizeContractParticulars trims every value", () => {
  const normalized = normalizeContractParticulars({
    ...EMPTY_CONTRACT_PARTICULARS,
    ownerAddress: "  12 King St  ",
    specialConditions: "\n Retain the tree \n",
  });
  assert.equal(normalized.ownerAddress, "12 King St");
  assert.equal(normalized.specialConditions, "Retain the tree");
});

test("contractParticularsToLockedTabs only emits filled fields, all locked", () => {
  const particulars: ContractParticulars = {
    ...EMPTY_CONTRACT_PARTICULARS,
    hbcfCost: "$1,250",
    ownerAddress: "  12 King St  ",
    interestRate: "   ", // whitespace-only counts as blank
  };
  const tabs = contractParticularsToLockedTabs(particulars);
  const byLabel = new Map(tabs.map((tab) => [tab.tabLabel, tab]));

  assert.equal(tabs.length, 2, "only the two non-blank fields become tabs");
  assert.equal(byLabel.get("hbcfCost")?.value, "$1,250");
  assert.equal(byLabel.get("ownerAddress")?.value, "12 King St");
  assert.equal(byLabel.has("interestRate"), false);
  assert.ok(
    tabs.every((tab) => tab.locked === true),
    "every emitted tab is locked",
  );
});

test("tab labels are 1:1 with the template's field keys", () => {
  const particulars = { ...EMPTY_CONTRACT_PARTICULARS } as Record<
    string,
    string
  >;
  for (const field of CONTRACT_PARTICULAR_FIELDS) {
    particulars[field.key] = `v-${field.key}`;
  }
  const tabs = contractParticularsToLockedTabs(
    particulars as unknown as ContractParticulars,
  );
  assert.equal(tabs.length, CONTRACT_PARTICULAR_FIELDS.length);
  for (const field of CONTRACT_PARTICULAR_FIELDS) {
    const tab = tabs.find((t) => t.tabLabel === field.key);
    assert.ok(tab, `tab for ${field.key} is present`);
    assert.equal(tab?.value, `v-${field.key}`);
  }
});

test("missingRecommendedParticulars flags only blank recommended fields", () => {
  // All blank → every recommended field is missing.
  const allMissing = missingRecommendedParticulars(EMPTY_CONTRACT_PARTICULARS);
  const recommendedCount = CONTRACT_PARTICULAR_FIELDS.filter(
    (field) => field.recommendedBeforeSend,
  ).length;
  assert.equal(allMissing.length, recommendedCount);
  assert.ok(recommendedCount > 0, "there is at least one recommended field");

  // Fill every recommended field → nothing missing. Non-recommended stay blank.
  const filled = { ...EMPTY_CONTRACT_PARTICULARS } as Record<string, string>;
  for (const field of CONTRACT_PARTICULAR_FIELDS) {
    if (field.recommendedBeforeSend) {
      filled[field.key] = "done";
    }
  }
  assert.equal(
    missingRecommendedParticulars(filled as unknown as ContractParticulars)
      .length,
    0,
  );
});

test("Step 8 derives corresponding particulars from earlier offer steps", () => {
  const defaults = deriveContractParticularDefaults({
    currentLocation: "12 King Street, Parramatta NSW 2150",
    ownerPhone: "0400 123 456",
    hbcfPremium: 7528.52,
  });

  assert.equal(defaults.ownerAddress, "12 King Street, Parramatta NSW 2150");
  assert.equal(defaults.ownerPhone, "0400 123 456");
  assert.equal(defaults.hbcfCost, "$7,528.52");
  assert.equal(
    defaults.commencementDate,
    "",
    "fields without a corresponding earlier-step value stay blank",
  );
});

test("Step 8 refreshes derived values without overwriting estimator edits", () => {
  const previousDefaults = deriveContractParticularDefaults({
    currentLocation: "12 King Street",
    ownerPhone: "0400 123 456",
    hbcfPremium: 7528.52,
  });
  const nextDefaults = deriveContractParticularDefaults({
    currentLocation: "24 Queen Street",
    ownerPhone: "0400 999 999",
    hbcfPremium: 8100,
  });

  const refreshed = reconcileContractParticularDefaults(
    {
      ...previousDefaults,
      ownerPhone: "02 9000 0000",
      hbcfCost: "",
    },
    nextDefaults,
    ["ownerPhone"],
  );

  assert.equal(
    refreshed.ownerAddress,
    "24 Queen Street",
    "an unchanged auto-populated value follows its earlier-step source",
  );
  assert.equal(
    refreshed.ownerPhone,
    "02 9000 0000",
    "a manual override remains editable and is preserved",
  );
  assert.equal(
    refreshed.hbcfCost,
    "$8,100.00",
    "clearing an auto-populated value resets it to the current earlier-step value",
  );
});

test("Step 8 persists manual override provenance across reloads", () => {
  const particulars = {
    ...EMPTY_CONTRACT_PARTICULARS,
    ownerAddress: "12 King Street",
    ownerPhone: "02 9000 0000",
    hbcfCost: "",
  };
  const stored = serializeContractParticulars(particulars, [
    "ownerPhone",
    "hbcfCost",
  ]);

  assert.deepEqual(parseContractParticulars(stored), particulars);
  assert.deepEqual(parseContractParticularOverrides(stored), ["ownerPhone"]);
  assert.deepEqual(
    parseContractParticularOverrides({ hbcfCost: "$1,250.00" }),
    ["hbcfCost"],
    "legacy non-blank derived fields remain manual instead of being overwritten",
  );
});
