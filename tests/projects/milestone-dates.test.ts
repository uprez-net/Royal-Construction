import assert from "node:assert/strict";
import { test } from "node:test";

import { MilestoneStatus } from "@prisma/client";

import { reviveMilestoneDates } from "../../lib/projects/milestone-dates";
import {
  partitionActivities,
  sortActivities,
} from "../../lib/projects/milestone-ledger";

/** A milestone as the RSC payload delivers it: real Dates. */
const fromServer = (
  name: string,
  status: MilestoneStatus,
  target: string,
  actual: string | null,
) => ({
  name,
  status,
  targetDate: new Date(target),
  startDate: null,
  actualDate: actual ? new Date(actual) : null,
  childrenMilestones: [],
});

/**
 * The same milestone after a round trip through fetchJson. `SafeMilestone`
 * still types these as Date; JSON has no date type, so they are strings.
 */
const fromApi = (
  name: string,
  status: MilestoneStatus,
  target: string,
  actual: string | null,
) =>
  ({
    name,
    status,
    targetDate: new Date(target).toISOString(),
    startDate: null,
    actualDate: actual ? new Date(actual).toISOString() : null,
    childrenMilestones: [],
  }) as unknown as ReturnType<typeof fromServer>;

test("revives ISO strings from an API response into Dates", () => {
  const revived = reviveMilestoneDates(
    fromApi("Slab pour", MilestoneStatus.DONE, "2026-09-01", "2026-09-03"),
  );

  assert.ok(revived.targetDate instanceof Date);
  assert.ok(revived.actualDate instanceof Date);
  assert.equal(revived.actualDate?.toISOString(), "2026-09-03T00:00:00.000Z");
});

test("leaves a milestone that already carries Dates alone", () => {
  const original = fromServer(
    "Frame",
    MilestoneStatus.DONE,
    "2026-09-01",
    "2026-09-03",
  );
  const revived = reviveMilestoneDates(original);

  assert.equal(revived.targetDate.getTime(), original.targetDate.getTime());
  assert.equal(revived.actualDate?.getTime(), original.actualDate?.getTime());
});

// An Invalid Date poisons every comparison it touches with NaN and sorts
// unpredictably; null reads as "no date recorded" everywhere downstream.
test("an unparseable date becomes null rather than an Invalid Date", () => {
  const revived = reviveMilestoneDates(
    fromApi("Odd", MilestoneStatus.DONE, "2026-09-01", null),
  );

  assert.equal(revived.startDate, null);
  assert.equal(revived.actualDate, null);
});

/**
 * The reported crash. The store seeds from the RSC payload (Dates), then a
 * mutation merges an API response (strings) over one entry, so the array holds
 * a mix. Array.prototype.sort never calls the comparator on a single element,
 * which is why the FIRST completion in a stage is fine and the second throws.
 */
test("partitionActivities throws on a store polluted with string dates", () => {
  const polluted = [
    fromServer("Piering", MilestoneStatus.DONE, "2026-09-01", "2026-09-02"),
    fromApi("Slab pour", MilestoneStatus.DONE, "2026-09-03", "2026-09-04"),
  ];

  assert.throws(
    () => partitionActivities(polluted),
    /getTime is not a function/,
  );
});

test("reviving at the boundary makes the same stage sort cleanly", () => {
  const revived = [
    fromServer("Piering", MilestoneStatus.DONE, "2026-09-01", "2026-09-02"),
    reviveMilestoneDates(
      fromApi("Slab pour", MilestoneStatus.DONE, "2026-09-03", "2026-09-04"),
    ),
  ];

  const { open, settled } = partitionActivities(revived);

  assert.equal(open.length, 0);
  // Most recently completed first.
  assert.deepEqual(
    settled.map((milestone) => milestone.name),
    ["Slab pour", "Piering"],
  );
});

// The same exposure through targetDate, which bites as soon as two activities
// are open at once rather than only on completion.
test("open activities sort cleanly once revived", () => {
  const revived = [
    reviveMilestoneDates(
      fromApi("Windows", MilestoneStatus.ACTIVE, "2026-09-10", null),
    ),
    fromServer("Roof", MilestoneStatus.PENDING, "2026-09-05", null),
  ];

  assert.deepEqual(
    sortActivities(revived).map((milestone) => milestone.name),
    ["Windows", "Roof"],
  );
});
