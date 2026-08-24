import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectProjectDateBlockers,
  partitionBlockers,
  ProjectDateBlockerError,
} from "../../lib/data/projectReadiness";

// ---------------------------------------------------------------------------
// collectProjectDateBlockers — block severity
// ---------------------------------------------------------------------------

test("block: start date before signed date", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-05-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });

  const block = blockers.find((b) => b.id === "start_before_signed");
  assert.ok(block, "expected a start_before_signed blocker");
  assert.equal(block!.severity, "block");
  assert.equal(block!.fieldPath, "requirements.legalAdministration.signedDate");
});

test("block: signed date more than a year before start date", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-01-01",
    startDate: "2027-06-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });

  const block = blockers.find((b) => b.id === "signed_far_before_start");
  assert.ok(block, "expected a signed_far_before_start blocker");
  assert.equal(block!.severity, "block");
});

test("no blockers when dates are valid and start is after signed", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-07-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });

  assert.equal(blockers.length, 0);
});

// ---------------------------------------------------------------------------
// collectProjectDateBlockers — warn severity
// ---------------------------------------------------------------------------

test("warn: PCA missing on an ACTIVE project", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-07-01",
    pcaInspector: null,
    status: "ACTIVE",
  });

  const warn = blockers.find((b) => b.id === "pca_missing");
  assert.ok(warn, "expected a pca_missing blocker");
  assert.equal(warn!.severity, "warn");
  assert.equal(warn!.fieldPath, "requirements.legalAdministration.pcaInspector");
});

test("warn: PCA missing on a NEEDS_ATTENTION project is also flagged", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-07-01",
    pcaInspector: "",
    status: "NEEDS_ATTENTION",
  });

  // The spec says warn when status is ACTIVE; NEEDS_ATTENTION is the
  // downstream result of a prior warn, so we do NOT re-warn on it.
  const pcaBlocker = blockers.find((b) => b.id === "pca_missing");
  assert.equal(pcaBlocker, undefined);
});

test("warn: unparseable signed date", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "not-a-date",
    startDate: "2026-07-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });

  const warn = blockers.find((b) => b.id === "signed_date_unparseable");
  assert.ok(warn, "expected a signed_date_unparseable blocker");
  assert.equal(warn!.severity, "warn");
  assert.equal(warn!.fieldPath, "requirements.legalAdministration.signedDate");
});

test("no warn for empty signed date (it is just not set)", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: null,
    startDate: "2026-07-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });

  // Empty signed date is not unparseable — there is nothing to parse.
  assert.equal(
    blockers.find((b) => b.id === "signed_date_unparseable"),
    undefined,
  );
});

test("PCA missing does not warn when status is not ACTIVE", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-07-01",
    pcaInspector: null,
    status: "COMPLETED",
  });

  assert.equal(
    blockers.find((b) => b.id === "pca_missing"),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// combined block + warn
// ---------------------------------------------------------------------------

test("start_before_signed and pca_missing can both fire", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-05-01",
    pcaInspector: null,
    status: "ACTIVE",
  });

  assert.equal(blockers.length, 2);
  const { blocks, warns } = partitionBlockers(blockers);
  assert.equal(blocks.length, 1);
  assert.equal(warns.length, 1);
  assert.equal(blocks[0].id, "start_before_signed");
  assert.equal(warns[0].id, "pca_missing");
});

// ---------------------------------------------------------------------------
// partitionBlockers
// ---------------------------------------------------------------------------

test("partitionBlockers splits blocks and warns", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-05-01",
    pcaInspector: null,
    status: "ACTIVE",
  });

  const { blocks, warns } = partitionBlockers(blockers);
  assert.equal(blocks.length, 1);
  assert.equal(warns.length, 1);
  assert.equal(blocks[0].severity, "block");
  assert.equal(warns[0].severity, "warn");
});

test("partitionBlockers on empty list returns empty arrays", () => {
  const { blocks, warns } = partitionBlockers([]);
  assert.equal(blocks.length, 0);
  assert.equal(warns.length, 0);
});

// ---------------------------------------------------------------------------
// ProjectDateBlockerError
// ---------------------------------------------------------------------------

test("ProjectDateBlockerError carries the blocker list and a message", () => {
  const blockers = collectProjectDateBlockers({
    signedDate: "2026-06-12",
    startDate: "2026-05-01",
    pcaInspector: "Inspector Lee",
    status: "ACTIVE",
  });
  const { blocks } = partitionBlockers(blockers);
  const err = new ProjectDateBlockerError(blocks);
  assert.equal(err.name, "ProjectDateBlockerError");
  assert.equal(err.blockers.length, 1);
  assert.ok(err.message.includes("start date"), `message should mention the start date: ${err.message}`);
});
