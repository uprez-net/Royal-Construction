import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSiteParticulars } from "../../lib/offer/workspace-print-template";
import {
  STANDARD_INCLUSION_HIGHLIGHTS,
  OFFER_SPEC_FACTS,
  STANDARD_INCLUSIONS_SCHEDULE,
} from "../../lib/offer/workspace-proposal-content";

// ─── Site particulars (issue #86: "Lot Size showing as 0") ───
// Lot area / DP / zoning had no form input at all, so every document printed the
// model defaults. The inputs now exist, but an offer drawn up before the survey
// comes back still has none — and printing "Lot Area: 0 m²" on a client-facing
// document states a measurement that was never taken.

test("REGRESSION: an unset lot area is omitted, never printed as 0 m²", () => {
  // Given a job whose site particulars have not been filled in
  const job = { lotAreaSqm: 0, zoning: "" };

  // When
  const line = formatSiteParticulars(job);

  // Then nothing is claimed at all — no false zero, no dangling label
  assert.equal(line, "");
  assert.ok(!line.includes("0"));
  assert.ok(!line.includes("Zoning"));
});

test("a known lot area prints without a dangling zoning label", () => {
  // Given a surveyed lot but no zoning yet
  const job = { lotAreaSqm: 450.5, zoning: "  " };

  // When
  const line = formatSiteParticulars(job);

  // Then
  assert.equal(line, "Lot Area: 450.5 m²");
});

test("zoning alone prints without an invented lot area", () => {
  // Given zoning from the DA but no survey
  const job = { lotAreaSqm: 0, zoning: "R2 Low Density Residential" };

  // When
  const line = formatSiteParticulars(job);

  // Then
  assert.equal(line, "Zoning: R2 Low Density Residential");
});

test("both particulars are joined the way the proposal snapshot reads", () => {
  // Given a fully specified site
  const job = { lotAreaSqm: 512, zoning: "R2" };

  // When
  const line = formatSiteParticulars(job);

  // Then
  assert.equal(line, "Lot Area: 512 m² | Zoning: R2");
});

// ─── Cross-page spec agreement (issue #86 items 4 and 5) ───
// The Investment Summary bullets and the Inclusions Schedule are two lists in one
// file and had already drifted: 40mm stone on the schedule vs 60mm in the
// bullets, and a $30/m² porcelain tile allowance sold as herringbone timber. The
// client could not tell which contract they were signing. Every fact printed on
// both pages now comes from OFFER_SPEC_FACTS, and these tests fail if either list
// starts stating one independently again.

function scheduleSpecFor(category: string): string {
  const row = STANDARD_INCLUSIONS_SCHEDULE.find(
    (entry) => entry.category === category,
  );
  assert.ok(row, `inclusions schedule has no "${category}" row`);
  return row.specification;
}

function bulletContaining(fragment: string): string {
  const bullet = STANDARD_INCLUSION_HIGHLIGHTS.find((line) =>
    line.includes(fragment),
  );
  assert.ok(bullet, `no investment-summary bullet mentions "${fragment}"`);
  return bullet;
}

test("REGRESSION: living-area flooring is the same finish on the summary and the schedule", () => {
  // Given the two pages that both describe the living-area floor
  const schedule = scheduleSpecFor("Flooring — Living");
  const bullet = bulletContaining(OFFER_SPEC_FACTS.livingFloorFinish);

  // Then both quote the priced finish, and neither promises timber
  assert.ok(schedule.includes(OFFER_SPEC_FACTS.livingFloorFinish));
  assert.ok(bullet.includes(OFFER_SPEC_FACTS.livingFloorFinish));
  assert.ok(!bullet.toLowerCase().includes("herringbone"));
});

test("REGRESSION: stone benchtop thickness agrees across the summary and the schedule", () => {
  // Given
  const schedule = scheduleSpecFor("Stone Benchtops");
  const bullet = bulletContaining("stone benchtops");

  // Then one thickness, stated once
  assert.ok(schedule.includes(OFFER_SPEC_FACTS.stoneBenchtopThickness));
  assert.ok(bullet.includes(OFFER_SPEC_FACTS.stoneBenchtopThickness));
  assert.ok(!bullet.includes("60mm"));
});

test("ducted air conditioning capacity agrees across the summary and the schedule", () => {
  // Given
  const schedule = scheduleSpecFor("Ducted Air Con");
  const bullet = bulletContaining("ducted air conditioning");

  // Then
  assert.ok(schedule.includes(OFFER_SPEC_FACTS.ductedAirConditioning));
  assert.ok(bullet.includes(OFFER_SPEC_FACTS.ductedAirConditioning));
});
