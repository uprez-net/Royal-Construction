import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainStaleVersionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { setMilestonePrice } from "@/lib/domain/projects/milestone-price";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// The Financials tab's inline price edit writes Milestone.budget. A parent's
// budget includes its children, so the change rolls up; the stage price is
// pegged to the contract and is not touched here at all.

const PROJECT = {
  id: "project-1",
  location: "Penrith",
  name: "Smith build",
  siteManagerId: null,
};

const dollars = (value: number) => new Prisma.Decimal(value);

function db(
  milestone: {
    budget: number;
    parentId?: string | null;
    children?: number[];
  },
  extra: Record<string, unknown> = {},
) {
  return recordingDb({
    "milestone.findUnique": { projectId: PROJECT.id },
    "milestone.findUniqueOrThrow": {
      budget: dollars(milestone.budget),
      childrenMilestones: (milestone.children ?? []).map((budget) => ({
        budget: dollars(budget),
      })),
      id: "trusses",
      name: "Roof trusses",
      parentId: milestone.parentId ?? null,
    },
    "milestone.updateMany": { count: 1 },
    "project.findUnique": PROJECT,
    ...extra,
  });
}

describe("setMilestonePrice", () => {
  test("writes the price, moves every parent by the same amount, and logs it", async () => {
    const parents: Record<string, string | null> = {
      frame: "structure",
      structure: null,
    };
    const recorder = db(
      { budget: 5_000, parentId: "frame" },
      {
        "milestone.update": (args: unknown) => {
          const id = (args as { where: { id: string } }).where.id;
          return { id, parentId: parents[id] };
        },
      },
    );

    const outcome = await setMilestonePrice(
      adminPrincipal(),
      {
        milestoneId: "trusses",
        previousPriceCents: 500_000,
        priceCents: 650_050,
      },
      recorder.db,
    );

    assert.deepEqual(outcome, {
      ancestorIds: ["frame", "structure"],
      changed: true,
      milestoneId: "trusses",
      projectId: PROJECT.id,
    });
    const writes = recorder.writes();
    assert.deepEqual(
      writes.map((write) => write.operation),
      [
        "milestone.updateMany",
        "milestone.update",
        "milestone.update",
        "activityLog.create",
      ],
    );
    type Write = {
      data: {
        budget?: Prisma.Decimal & { increment?: Prisma.Decimal };
        message?: string;
      };
      where: { budget?: Prisma.Decimal };
    };
    const [own, frame, , log] = writes.map((write) => write.args as Write);
    assert.equal(own.data.budget?.toString(), "6500.5");
    // Conditional on the figure read, so a racing second save cannot apply twice.
    assert.equal(own.where.budget?.toString(), "5000");
    assert.equal(frame.data.budget?.increment?.toString(), "1500.5");
    assert.match(
      log.data.message ?? "",
      /Roof trusses quoted price changed from \$5,000\.00 to \$6,500\.50/,
    );
  });

  test("saving the figure it already holds is a replay, and writes nothing", async () => {
    const recorder = db({ budget: 6_500 });
    const outcome = await setMilestonePrice(
      adminPrincipal(),
      {
        milestoneId: "trusses",
        previousPriceCents: 500_000,
        priceCents: 650_000,
      },
      recorder.db,
    );
    assert.equal(outcome.changed, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a price that moved since the screen loaded is refused", async () => {
    const recorder = db({ budget: 5_200 });
    await assert.rejects(
      setMilestonePrice(
        adminPrincipal(),
        {
          milestoneId: "trusses",
          previousPriceCents: 500_000,
          priceCents: 650_000,
        },
        recorder.db,
      ),
      DomainStaleVersionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("losing a race to the same save is answered as a replay", async () => {
    let reads = 0;
    const recorder = db(
      { budget: 5_000 },
      {
        "milestone.findUniqueOrThrow": () =>
          ++reads === 1
            ? {
                budget: dollars(5_000),
                childrenMilestones: [],
                id: "trusses",
                name: "Roof trusses",
                parentId: "frame",
              }
            : { budget: dollars(6_500) },
        "milestone.updateMany": { count: 0 },
      },
    );
    const outcome = await setMilestonePrice(
      adminPrincipal(),
      {
        milestoneId: "trusses",
        previousPriceCents: 500_000,
        priceCents: 650_000,
      },
      recorder.db,
    );
    assert.equal(outcome.changed, false);
    // Only the refused conditional write: no parent moved, nothing logged.
    assert.deepEqual(
      recorder.writes().map((write) => write.operation),
      ["milestone.updateMany"],
    );
  });

  test("a parent cannot be priced below its sub-activities", async () => {
    const recorder = db({ budget: 5_000, children: [2_000, 2_500] });
    await assert.rejects(
      setMilestonePrice(
        adminPrincipal(),
        {
          milestoneId: "trusses",
          previousPriceCents: 500_000,
          priceCents: 400_000,
        },
        recorder.db,
      ),
      (error: unknown) =>
        error instanceof DomainValidationError
        && /below its sub-activities, which add up to \$4,500\.00/.test(
          error.message,
        ),
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a negative or fractional-cent price is refused before anything is read", async () => {
    for (const priceCents of [-1, 10.5]) {
      const recorder = db({ budget: 5_000 });
      await assert.rejects(
        setMilestonePrice(
          adminPrincipal(),
          { milestoneId: "trusses", previousPriceCents: 500_000, priceCents },
          recorder.db,
        ),
        DomainValidationError,
      );
      assert.deepEqual(recorder.writes(), []);
    }
  });

  test("admin only, like the Financials tab", async () => {
    const recorder = db({ budget: 5_000 });
    await assert.rejects(
      setMilestonePrice(
        siteManagerPrincipal(),
        {
          milestoneId: "trusses",
          previousPriceCents: 500_000,
          priceCents: 650_000,
        },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});
