import assert from "node:assert/strict";
import { test } from "node:test";

import { MilestoneStatus } from "@prisma/client";

import {
  type LedgerMilestone,
  type StageState,
  daysLate,
  duenessOf,
  findWorkingStageIndex,
  flattenMilestones,
  isSettled,
  lastCompleted,
  nextActivity,
  partitionActivities,
  sortActivities,
  stageClaimAmount,
  stageRollup,
  stageState,
} from "../../lib/projects/milestone-ledger";

function activity(
  name: string,
  status: MilestoneStatus,
  targetDate: string,
  extra: { actualDate?: string; children?: LedgerMilestone[] } = {},
): LedgerMilestone {
  return {
    name,
    status,
    targetDate: new Date(targetDate),
    actualDate: extra.actualDate ? new Date(extra.actualDate) : null,
    childrenMilestones: extra.children ?? [],
  };
}

const { ACTIVE, PENDING, DONE, NOT_REQUIRED } = MilestoneStatus;

test("a waived activity is settled, so it never counts as outstanding work", () => {
  assert.equal(isSettled({ status: NOT_REQUIRED }), true);
  assert.equal(isSettled({ status: DONE }), true);
  assert.equal(isSettled({ status: ACTIVE }), false);
  assert.equal(isSettled({ status: PENDING }), false);
});

test("the roll-up excludes waived activities from BOTH sides of the ratio", () => {
  // The defect this pins: the old header counted NOT_REQUIRED as done and said
  // "5 of 8", while the fold beneath it said "4 done · 1 not required". Two
  // numbers for one stage. Waived work was never work, so it leaves the ratio
  // entirely rather than being scored as a win.
  const slab = [
    activity("Cut & fill", DONE, "2026-08-01", { actualDate: "2026-08-03" }),
    activity("Piering", DONE, "2026-08-08", { actualDate: "2026-08-07" }),
    activity("Drainage", DONE, "2026-08-10", { actualDate: "2026-08-11" }),
    activity("Plumbing rough-in", DONE, "2026-08-14", {
      actualDate: "2026-08-14",
    }),
    activity("Termite barrier", NOT_REQUIRED, "2026-08-18"),
    activity("Steel reinforcement", ACTIVE, "2026-08-27"),
    activity("Slab pour", PENDING, "2026-09-02"),
    activity("Certifier inspection", PENDING, "2026-09-05"),
  ];

  assert.deepEqual(stageRollup(slab), {
    done: 4,
    total: 7,
    notRequired: 1,
    remaining: 3,
  });
});

test("the roll-up counts top-level rows only, matching what the tab lists", () => {
  // Children roll up into their parent's own status; counting them here would
  // make the ratio disagree with the visible list of rows.
  const stage = [
    activity("Steel reinforcement", ACTIVE, "2026-08-27", {
      children: [
        activity("Formwork check", ACTIVE, "2026-08-22"),
        activity("Mesh and bar chairs", PENDING, "2026-08-26"),
      ],
    }),
  ];

  assert.deepEqual(stageRollup(stage), {
    done: 0,
    total: 1,
    notRequired: 0,
    remaining: 1,
  });
});

test("an empty stage reports nothing rather than dividing by zero", () => {
  assert.deepEqual(stageRollup([]), {
    done: 0,
    total: 0,
    notRequired: 0,
    remaining: 0,
  });
  assert.equal(stageState([]), "upcoming");
});

test("a stage with one unfinished sub-activity is not complete", () => {
  // Reading only the top level would call this stage complete and, on a tab
  // where a complete stage is what a progress claim rests on, that is the
  // expensive direction to be wrong in.
  const stage = [
    activity("Piering", DONE, "2026-08-08", {
      actualDate: "2026-08-07",
      children: [
        activity("Pier holes", DONE, "2026-08-05", { actualDate: "2026-08-05" }),
        activity("Engineer inspection", PENDING, "2026-08-07"),
      ],
    }),
  ];

  assert.equal(stageState(stage), "active");
});

test("a stage is complete only when every activity and sub-activity is settled", () => {
  const stage = [
    activity("Contract executed", DONE, "2026-07-10", {
      actualDate: "2026-07-09",
    }),
    activity("Deposit received", NOT_REQUIRED, "2026-07-17"),
  ];

  assert.equal(stageState(stage), "complete");
});

test("a stage nobody has touched is upcoming, not active", () => {
  const stage = [
    activity("Wall frames delivered", PENDING, "2026-09-09"),
    activity("Frames stood", PENDING, "2026-09-13"),
  ];

  assert.equal(stageState(stage), "upcoming");
});

test("a stage with finished work but nothing in flight still reads as active", () => {
  const stage = [
    activity("Wall frames delivered", DONE, "2026-09-09", {
      actualDate: "2026-09-09",
    }),
    activity("Frames stood", PENDING, "2026-09-13"),
  ];

  assert.equal(stageState(stage), "active");
});

test("activities sort active first, then pending, with settled work last", () => {
  const sorted = sortActivities([
    activity("Done thing", DONE, "2026-08-01", { actualDate: "2026-08-01" }),
    activity("Pending thing", PENDING, "2026-09-02"),
    activity("Waived thing", NOT_REQUIRED, "2026-08-18"),
    activity("Active thing", ACTIVE, "2026-08-27"),
  ]);

  assert.deepEqual(
    sorted.map((milestone) => milestone.name),
    ["Active thing", "Pending thing", "Done thing", "Waived thing"],
  );
});

test("same-status activities sort by target date, soonest first", () => {
  const sorted = sortActivities([
    activity("Later", PENDING, "2026-09-05"),
    activity("Sooner", PENDING, "2026-09-02"),
  ]);

  assert.deepEqual(
    sorted.map((milestone) => milestone.name),
    ["Sooner", "Later"],
  );
});

test("partitioning lists open work in priority order and settled work newest-first", () => {
  const { open, settled } = partitionActivities([
    activity("Cut & fill", DONE, "2026-08-01", { actualDate: "2026-08-03" }),
    activity("Slab pour", PENDING, "2026-09-02"),
    activity("Plumbing rough-in", DONE, "2026-08-14", {
      actualDate: "2026-08-14",
    }),
    activity("Steel reinforcement", ACTIVE, "2026-08-27"),
  ]);

  assert.deepEqual(
    open.map((milestone) => milestone.name),
    ["Steel reinforcement", "Slab pour"],
  );
  assert.deepEqual(
    settled.map((milestone) => milestone.name),
    ["Plumbing rough-in", "Cut & fill"],
  );
});

test("the next activity is the active LEAF, not its parent", () => {
  // A parent with children carries no Finish button — its children are what
  // move. Naming the parent would point the builder at a row they cannot act on.
  const stage = [
    activity("Steel reinforcement", ACTIVE, "2026-08-27", {
      children: [
        activity("Formwork check", ACTIVE, "2026-08-22"),
        activity("Mesh and bar chairs", PENDING, "2026-08-26"),
      ],
    }),
  ];

  const next = nextActivity(stage);
  assert.equal(next?.activity.name, "Formwork check");
  assert.equal(next?.parent?.name, "Steel reinforcement");
});

test("a childless active activity is its own next step, with no parent", () => {
  const next = nextActivity([activity("Slab pour", ACTIVE, "2026-09-02")]);

  assert.equal(next?.activity.name, "Slab pour");
  assert.equal(next?.parent, null);
});

test("with nothing active, the next activity is the earliest-due pending one", () => {
  const next = nextActivity([
    activity("Certifier inspection", PENDING, "2026-09-05"),
    activity("Slab pour", PENDING, "2026-09-02"),
  ]);

  assert.equal(next?.activity.name, "Slab pour");
});

test("a pending sub-activity can be the next step, and reports its parent", () => {
  const next = nextActivity([
    activity("Piering", PENDING, "2026-09-20", {
      children: [activity("Pier holes", PENDING, "2026-09-01")],
    }),
  ]);

  assert.equal(next?.activity.name, "Pier holes");
  assert.equal(next?.parent?.name, "Piering");
});

test("a fully settled stage has no next activity", () => {
  assert.equal(
    nextActivity([
      activity("Contract executed", DONE, "2026-07-10", {
        actualDate: "2026-07-09",
      }),
      activity("Deposit", NOT_REQUIRED, "2026-07-17"),
    ]),
    null,
  );
  assert.equal(nextActivity([]), null);
});

test("dueness buckets a target date against today", () => {
  const today = new Date("2026-08-25T09:30:00");

  assert.deepEqual(duenessOf(new Date("2026-08-22T00:00:00"), today), {
    kind: "overdue",
    days: -3,
  });
  assert.deepEqual(duenessOf(new Date("2026-08-25T23:00:00"), today), {
    kind: "today",
    days: 0,
  });
  assert.deepEqual(duenessOf(new Date("2026-09-01T00:00:00"), today), {
    kind: "soon",
    days: 7,
  });
  assert.deepEqual(duenessOf(new Date("2026-09-02T00:00:00"), today), {
    kind: "scheduled",
    days: 8,
  });
});

test("dueness counts calendar days, so a later clock time is still 'today'", () => {
  // Elapsed-hours arithmetic would call 23:00 tonight "in 0.5d" and round it
  // into tomorrow; the builder cares which day it is, not how many hours.
  const today = new Date("2026-08-25T23:30:00");

  assert.deepEqual(duenessOf(new Date("2026-08-25T07:00:00"), today), {
    kind: "today",
    days: 0,
  });
  assert.deepEqual(duenessOf(new Date("2026-08-26T07:00:00"), today), {
    kind: "soon",
    days: 1,
  });
});

test("only lateness is reported; landing early or on time reports nothing", () => {
  // Stage-level target dates make "24d early" common and meaningless, and it
  // reads as a data error. Late is the half that carries a consequence.
  assert.equal(
    daysLate(new Date("2026-08-14T00:00:00"), new Date("2026-08-16T00:00:00")),
    2,
  );
  assert.equal(
    daysLate(new Date("2026-08-14T00:00:00"), new Date("2026-08-14T00:00:00")),
    0,
  );
  assert.equal(
    daysLate(new Date("2026-08-27T00:00:00"), new Date("2026-08-03T00:00:00")),
    0,
  );
});

test("the last completed activity is the most recent one, ignoring waived work", () => {
  const stage = [
    activity("Cut & fill", DONE, "2026-08-01", { actualDate: "2026-08-03" }),
    activity("Plumbing rough-in", DONE, "2026-08-14", {
      actualDate: "2026-08-14",
    }),
    activity("Termite barrier", NOT_REQUIRED, "2026-08-18"),
  ];

  assert.equal(lastCompleted(stage)?.name, "Plumbing rough-in");
});

test("a stage with no completed activity has no 'last' note", () => {
  assert.equal(lastCompleted([activity("Slab pour", PENDING, "2026-09-02")]), null);
});

test("the working stage is the first one not yet complete", () => {
  const states: StageState[] = [
    "complete",
    "active",
    "upcoming",
    "upcoming",
  ];

  assert.equal(findWorkingStageIndex(states), 1);
});

test("a stage skipped over still gates the ones behind it", () => {
  // Deposit complete, Slab untouched: Slab is the gate, not Frame, even though
  // neither has been started.
  assert.equal(findWorkingStageIndex(["complete", "upcoming", "upcoming"]), 1);
});

test("a finished schedule has no working stage", () => {
  assert.equal(findWorkingStageIndex(["complete", "complete"]), -1);
  assert.equal(findWorkingStageIndex([]), -1);
});

test("flatten walks the whole tree depth-first", () => {
  const stage = [
    activity("Piering", DONE, "2026-08-08", {
      actualDate: "2026-08-07",
      children: [
        activity("Pier holes", DONE, "2026-08-05", { actualDate: "2026-08-05" }),
        activity("Inspection", DONE, "2026-08-07", {
          actualDate: "2026-08-07",
          children: [activity("Re-check", PENDING, "2026-08-09")],
        }),
      ],
    }),
    activity("Slab pour", PENDING, "2026-09-02"),
  ];

  assert.deepEqual(
    flattenMilestones(stage).map((milestone) => milestone.name),
    ["Piering", "Pier holes", "Inspection", "Re-check", "Slab pour"],
  );
});

test("a stage claims the contract amount, even when it differs from the budget", () => {
  // The contract sum the schedule was priced against can differ from the
  // project budget; the agreed figure is the one that gets claimed.
  assert.equal(stageClaimAmount(4981, 15, 33207), 4981);
});

test("a stage with no stated amount falls back to its percentage of the budget", () => {
  // Compared within a cent: percentage-of-budget is binary float arithmetic,
  // so 5% of 33,207 lands on 1660.3500000000001, not 1660.35.
  const cent = 0.005;
  assert.ok(Math.abs((stageClaimAmount(null, 15, 33207) ?? 0) - 4981.05) < cent);
  assert.ok(
    Math.abs((stageClaimAmount(undefined, 5, 33207) ?? 0) - 1660.35) < cent,
  );
});

test("a stage claims nothing knowable without an amount, a percentage or a budget", () => {
  assert.equal(stageClaimAmount(null, null, 33207), null);
  assert.equal(stageClaimAmount(null, 15, Number.NaN), null);
});

test("a stated amount of zero is respected rather than recomputed", () => {
  // A waived stage claims nothing; falling through to the percentage would
  // silently re-bill it.
  assert.equal(stageClaimAmount(0, 15, 33207), 0);
});

test("an active parent with only pending children names a child, not itself", () => {
  // The regression: the fallback picked any ACTIVE activity once no active
  // leaf existed, which is the parent — a row that carries no Finish, so the
  // ledger pointed the builder at something they could not act on.
  const stage = [
    activity("Steel reinforcement", ACTIVE, "2026-08-27", {
      children: [
        activity("Mesh and bar chairs", PENDING, "2026-08-26"),
        activity("Formwork check", PENDING, "2026-08-22"),
      ],
    }),
  ];

  const next = nextActivity(stage);
  assert.equal(next?.activity.name, "Formwork check");
  assert.equal(next?.parent?.name, "Steel reinforcement");
});

test("an active parent whose children are all done names itself", () => {
  // Nothing is left beneath it, so it is the outstanding row and there is no
  // leaf to prefer.
  const stage = [
    activity("Piering", ACTIVE, "2026-08-08", {
      children: [
        activity("Pier holes", DONE, "2026-08-05", { actualDate: "2026-08-05" }),
        activity("Inspection", NOT_REQUIRED, "2026-08-07"),
      ],
    }),
  ];

  assert.equal(nextActivity(stage)?.activity.name, "Piering");
});

test("a settled activity is never the next step, at any depth", () => {
  const stage = [
    activity("Done parent", DONE, "2026-08-01", {
      actualDate: "2026-08-01",
      children: [activity("Done child", DONE, "2026-08-01", { actualDate: "2026-08-01" })],
    }),
    activity("Slab pour", PENDING, "2026-09-02"),
  ];

  assert.equal(nextActivity(stage)?.activity.name, "Slab pour");
});
