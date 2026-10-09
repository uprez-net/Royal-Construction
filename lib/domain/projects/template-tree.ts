import type { TemplateActivity } from "@/types/milestone-template";
import { buildMilestoneTree } from "@/lib/projects/milestone-tree";
import { DomainValidationError } from "../errors";

export function templateDescendants(
  rows: readonly TemplateActivity[],
  id: string,
): Set<string> {
  const result = new Set([id]);
  for (let previous = 0; previous !== result.size; ) {
    previous = result.size;
    for (const row of rows)
      if (row.parentId && result.has(row.parentId)) result.add(row.id);
  }
  return result;
}

/** Move the whole subtree, preserving the order of its sub-activities. */
export function moveTemplateActivity(
  rows: readonly TemplateActivity[],
  id: string,
  targetId: string | null,
  mode: "before" | "child" | "root",
): TemplateActivity[] {
  const source = rows.find((row) => row.id === id);
  const target = rows.find((row) => row.id === targetId);
  if (!source || (mode !== "root" && !target))
    throw new DomainValidationError("That activity no longer exists.");
  const descendants = templateDescendants(rows, id);
  if (target && descendants.has(target.id))
    throw new DomainValidationError(
      "Choose an activity outside this activity's sub-activities.",
    );
  const parentId =
    mode === "child" ? target!.id : mode === "before" ? target!.parentId : null;
  const moved = rows.map((row) =>
    row.id === id ? { ...row, parentId } : { ...row },
  );
  const branch = moved
    .filter((row) => descendants.has(row.id))
    .sort((a, b) => a.order - b.order);
  const remaining = moved
    .filter((row) => !descendants.has(row.id))
    .sort((a, b) => a.order - b.order);
  let index = remaining.length;
  if (target && mode === "before")
    index = remaining.findIndex((row) => row.id === target.id);
  if (target && mode === "child") {
    const targetBranch = templateDescendants(remaining, target.id);
    index = remaining.findLastIndex((row) => targetBranch.has(row.id)) + 1;
  }
  remaining.splice(index, 0, ...branch);
  // Renumber depth-first, so parent precedes child even after a keyboard reparent.
  const positioned = remaining.map((row, order) => ({
    ...row,
    order: order + 1,
  }));
  const result: TemplateActivity[] = [];
  const visit = (
    nodes: ReturnType<typeof buildMilestoneTree<TemplateActivity>>,
  ) => {
    for (const { childrenMilestones, ...row } of nodes) {
      result.push({ ...row, order: result.length + 1 });
      visit(childrenMilestones);
    }
  };
  visit(buildMilestoneTree(positioned));
  return result;
}
