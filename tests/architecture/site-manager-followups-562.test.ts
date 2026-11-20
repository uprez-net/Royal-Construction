import assert from "node:assert/strict";

import { Prisma, ProjectStatus } from "@prisma/client";
import { test } from "vitest";

import { DomainStaleVersionError } from "@/lib/domain/errors";
import { updateProject } from "@/lib/domain/projects/commands";
import { hideRequirementsFinancials } from "@/lib/domain/projects/financial-redaction";
import { requirementsVersion } from "@/lib/domain/projects/requirements-version";
import type { ProjectRequirementsPayload } from "@/types/project-flow";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Issue #562: the Overview save wrote `requirements` whole, matching only the
// project id, so a save made from an older copy silently replaced a newer one.
// The page now sends back the fingerprint of the requirements it was shown; a
// save is refused when the stored requirements, seen the same way, differ.
// Writes that never touch the requirements (a milestone, a compliance step)
// do not refuse it, which an `updatedAt` check would.

const STORED = {
  legalAdministration: {
    hbcfInsuranceNumber: "HB-1",
    pcaInspector: "Jo",
  },
  summary: "Brick veneer",
};

function projectDb(stored: unknown, matchingRows = 1) {
  return recordingDb({
    "project.findUnique": {
      customerId: null,
      id: "p_1",
      Lead: null,
      location: "12 Example Road",
      name: "Example",
      siteManagerId: "user_sm",
    },
    "project.findUniqueOrThrow": {
      requirements: stored,
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      status: ProjectStatus.ON_TRACK,
    },
    "project.updateMany": { count: matchingRows },
  });
}

test("the same requirements in any key order have the same fingerprint", () => {
  assert.equal(
    requirementsVersion({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }),
    requirementsVersion({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }),
  );
  assert.notEqual(requirementsVersion({ a: 1 }), requirementsVersion({ a: 2 }));
});

test("a save from an out-of-date copy is refused and writes nothing", async () => {
  const recorder = projectDb(STORED);
  await assert.rejects(
    updateProject(
      adminPrincipal(),
      {
        expectedRequirementsVersion: requirementsVersion({ summary: "old" }),
        name: "Renamed",
        projectId: "p_1",
      },
      recorder.db,
    ),
    (error: unknown) =>
      error instanceof DomainStaleVersionError && error.status === 409,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a save from the current copy writes, conditional on the requirements read", async () => {
  const recorder = projectDb(STORED);
  await updateProject(
    adminPrincipal(),
    {
      expectedRequirementsVersion: requirementsVersion(STORED),
      name: "Renamed",
      projectId: "p_1",
    },
    recorder.db,
  );
  const [write] = recorder.writes();
  assert.equal(write.operation, "project.updateMany");
  assert.deepEqual((write.args as { where: unknown }).where, {
    id: "p_1",
    requirements: { equals: STORED },
  });
});

test("two saves in the same moment: the second matches no row and is refused", async () => {
  const recorder = projectDb(STORED, 0);
  await assert.rejects(
    updateProject(
      adminPrincipal(),
      {
        expectedRequirementsVersion: requirementsVersion(STORED),
        name: "Renamed",
        projectId: "p_1",
      },
      recorder.db,
    ),
    DomainStaleVersionError,
  );
});

test("a site manager's copy is compared as they were shown it", async () => {
  // Their page never had the HBCF number, so its fingerprint is of the
  // redacted requirements; the save is not refused for it.
  const shown = hideRequirementsFinancials(
    STORED as unknown as ProjectRequirementsPayload,
  );
  const recorder = projectDb(STORED);
  await updateProject(
    siteManagerPrincipal("user_sm"),
    {
      expectedRequirementsVersion: requirementsVersion(shown),
      name: "Renamed",
      projectId: "p_1",
    },
    recorder.db,
  );
  assert.equal(recorder.writes()[0]?.operation, "project.updateMany");
});

test("a save without a fingerprint keeps the unconditional write", async () => {
  // The start date field and Eve save without one.
  const recorder = projectDb(STORED);
  await updateProject(
    adminPrincipal(),
    { name: "Renamed", projectId: "p_1" },
    recorder.db,
  );
  const [write] = recorder.writes();
  assert.equal(write.operation, "project.update");
  assert.deepEqual((write.args as { where: unknown }).where, { id: "p_1" });
});

test("a first save onto no stored requirements is conditional on SQL NULL, and a save matching no row is refused", async () => {
  const recorder = projectDb(null);
  await updateProject(
    adminPrincipal(),
    {
      expectedRequirementsVersion: requirementsVersion(null),
      name: "Renamed",
      projectId: "p_1",
    },
    recorder.db,
  );
  const [write] = recorder.writes();
  assert.equal(write.operation, "project.updateMany");
  assert.deepEqual((write.args as { where: unknown }).where, {
    id: "p_1",
    requirements: { equals: Prisma.DbNull },
  });

  // When the conditional write matches no row (the database's answer to a
  // second such save), the command refuses with nothing written.
  await assert.rejects(
    updateProject(
      adminPrincipal(),
      {
        expectedRequirementsVersion: requirementsVersion(null),
        name: "Renamed again",
        projectId: "p_1",
      },
      projectDb(null, 0).db,
    ),
    DomainStaleVersionError,
  );
});

test("the save returns the fingerprint of what it committed, as the caller sees it", async () => {
  const saved = { ...STORED, summary: "Double brick" };
  const result = await updateProject(
    siteManagerPrincipal("user_sm"),
    {
      expectedRequirementsVersion: requirementsVersion(
        hideRequirementsFinancials(
          STORED as unknown as ProjectRequirementsPayload,
        ),
      ),
      projectId: "p_1",
      requirements: saved,
    },
    projectDb(STORED).db,
  );
  // The HBCF number is restored on save (withStoredHbcf) and hidden in the
  // site manager's view, so their fingerprint is of the redacted copy.
  assert.equal(
    result.requirementsVersion,
    requirementsVersion(
      hideRequirementsFinancials({
        ...saved,
      } as unknown as ProjectRequirementsPayload),
    ),
  );
});
