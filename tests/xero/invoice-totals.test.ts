import assert from "node:assert/strict";
import { test } from "vitest";

import { summarizeInvoices } from "@/lib/projects/invoice-totals";
import {
  buildMilestoneTree,
  groupRootsByStage,
} from "@/lib/projects/milestone-tree";

test("adds up claims across statuses", () => {
  const totals = summarizeInvoices([
    { status: "PAID", total: "45000", amountPaid: "45000", amountDue: "0" },
    {
      status: "AUTHORISED",
      total: "135000",
      amountPaid: "20000",
      amountDue: "115000",
    },
  ]);

  assert.equal(totals.invoiced, "180000.00");
  assert.equal(totals.paid, "65000.00");
  assert.equal(totals.outstanding, "115000.00");
  assert.equal(totals.pendingCount, 1);
});

// A withdrawn claim was never really asked for, so counting its total as
// "invoiced" would overstate what the owner was billed.
test("excludes voided and deleted claims from every total", () => {
  const totals = summarizeInvoices([
    { status: "AUTHORISED", total: "100", amountPaid: "0", amountDue: "100" },
    { status: "VOIDED", total: "999", amountPaid: "0", amountDue: "999" },
    { status: "DELETED", total: "888", amountPaid: "0", amountDue: "888" },
  ]);

  assert.equal(totals.invoiced, "100.00");
  assert.equal(totals.outstanding, "100.00");
  assert.equal(totals.pendingCount, 1);
});

test("no claims is zero, not NaN", () => {
  const totals = summarizeInvoices([]);

  assert.deepEqual(totals, {
    invoiced: "0.00",
    paid: "0.00",
    outstanding: "0.00",
    pendingCount: 0,
  });
});

// Money reaches this helper as a Prisma Decimal, a string off an already
// serialized row, or a plain number. All three have to coerce the same way.
test("accepts decimals, strings and numbers alike", () => {
  const totals = summarizeInvoices([
    { status: "AUTHORISED", total: 100.5, amountPaid: "0.25", amountDue: null },
  ]);

  assert.equal(totals.invoiced, "100.50");
  assert.equal(totals.paid, "0.25");
  assert.equal(totals.outstanding, "0.00");
});

const stageMilestone = (
  id: string,
  order: number,
  projectStage: "Frame" | "Lockup" | "Slab",
  parentId: string | null = null,
) => ({ id, order, projectStage, parentId });

test("rebuilds the hierarchy regardless of input order", () => {
  const roots = buildMilestoneTree([
    stageMilestone("child", 2, "Slab", "parent"),
    stageMilestone("parent", 1, "Slab"),
  ]);

  assert.equal(roots.length, 1);
  assert.equal(roots[0].id, "parent");
  assert.equal(roots[0].childrenMilestones[0].id, "child");
});

test("sorts roots and children by contract order", () => {
  const roots = buildMilestoneTree([
    stageMilestone("b", 2, "Slab"),
    stageMilestone("a", 1, "Slab"),
    stageMilestone("a2", 5, "Slab", "a"),
    stageMilestone("a1", 4, "Slab", "a"),
  ]);

  assert.deepEqual(
    roots.map((root) => root.id),
    ["a", "b"],
  );
  assert.deepEqual(
    roots[0].childrenMilestones.map((child) => child.id),
    ["a1", "a2"],
  );
});

// A parentId pointing outside the list must not make the milestone vanish.
test("keeps an orphan as a root", () => {
  const roots = buildMilestoneTree([
    stageMilestone("orphan", 1, "Slab", "gone"),
  ]);

  assert.deepEqual(
    roots.map((root) => root.id),
    ["orphan"],
  );
});

// The template really does carry one of these — a Lockup activity hanging off a
// Frame inspection. Grouping on roots files it under Frame, which is what the
// Milestones tab shows; grouping flat would file it under Lockup and the two
// would disagree about when a stage is complete.
test("a sub-activity is grouped under its root's stage, not its own", () => {
  const grouped = groupRootsByStage(
    buildMilestoneTree([
      stageMilestone("frame-inspection", 31, "Frame"),
      stageMilestone("termite-glue", 35, "Lockup", "frame-inspection"),
    ]),
  );

  assert.equal(grouped.Frame?.length, 1);
  assert.equal(grouped.Frame?.[0].childrenMilestones[0].id, "termite-glue");
  assert.equal(grouped.Lockup, undefined);
});
