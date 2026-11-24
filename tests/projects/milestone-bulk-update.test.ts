import assert from "node:assert/strict";
import { MilestoneStatus as S } from "@prisma/client";
import { describe, it } from "vitest";

import {
  MAX_BULK_MILESTONE_UPDATES,
  updateMilestones,
} from "@/lib/domain/projects/milestones";
import {
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// #616: "move these five start dates" was five update_milestone calls in one
// step, so five approvals, and eve ran none of them. One bulk call is one
// approval; these pin the rules it adds on top of updateMilestone.

function harness(rows: { id: string; projectId: string }[]) {
  return recordingDb({ "milestone.findMany": rows });
}

const update = (milestoneId: string) => ({
  milestoneId,
  startDate: "2026-12-01",
  status: S.PENDING,
});

describe("updateMilestones", () => {
  it("refuses milestones from two projects, and writes nothing", async () => {
    const recorder = harness([
      { id: "a", projectId: "p1" },
      { id: "b", projectId: "p2" },
    ]);
    await assert.rejects(
      updateMilestones(
        adminPrincipal(),
        { updates: [update("a"), update("b")] },
        recorder.db,
      ),
      (error) =>
        error instanceof DomainValidationError
        && /one project/.test(error.message),
    );
    assert.deepEqual(recorder.writes(), []);
  });

  it("refuses milestones that are not on the project the caller named", async () => {
    const recorder = harness([
      { id: "a", projectId: "p1" },
      { id: "b", projectId: "p1" },
    ]);
    await assert.rejects(
      updateMilestones(
        adminPrincipal(),
        { projectId: "p2", updates: [update("a"), update("b")] },
        recorder.db,
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  it("refuses the same milestone twice", async () => {
    const recorder = harness([{ id: "a", projectId: "p1" }]);
    await assert.rejects(
      updateMilestones(
        adminPrincipal(),
        { updates: [update("a"), update("a")] },
        recorder.db,
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  it("refuses a milestone that does not exist", async () => {
    const recorder = harness([{ id: "a", projectId: "p1" }]);
    await assert.rejects(
      updateMilestones(
        adminPrincipal(),
        { updates: [update("a"), update("missing")] },
        recorder.db,
      ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  it("refuses more than one approval card's worth", async () => {
    const recorder = harness([]);
    await assert.rejects(
      updateMilestones(
        adminPrincipal(),
        {
          updates: Array.from(
            { length: MAX_BULK_MILESTONE_UPDATES + 1 },
            (_, index) => update(`m${index}`),
          ),
        },
        recorder.db,
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});
