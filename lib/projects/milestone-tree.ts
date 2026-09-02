import type { ProjectStage } from "@prisma/client";

/** The minimum a milestone must carry to be placed in the tree. */
export interface TreeMilestone {
  id: string;
  parentId: string | null;
  order: number;
  projectStage: ProjectStage;
}

/** A milestone with its descendants attached. */
export type WithChildren<T> = T & { childrenMilestones: WithChildren<T>[] };

/**
 * Rebuild the parent/child hierarchy from a flat milestone list.
 *
 * Two passes, because the input order says nothing about hierarchy: a child can
 * appear before its parent, and orphans (a `parentId` pointing at a milestone
 * outside this list) must not silently vanish — they are simply not attached.
 * Roots and children are sorted by `order` so the tree renders and reads in
 * contract sequence.
 */
export function buildMilestoneTree<T extends TreeMilestone>(
  milestones: readonly T[],
): WithChildren<T>[] {
  const byId = new Map<string, WithChildren<T>>(
    milestones.map((milestone) => [
      milestone.id,
      { ...milestone, childrenMilestones: [] },
    ]),
  );

  const roots: WithChildren<T>[] = [];
  for (const milestone of byId.values()) {
    const parent = milestone.parentId ? byId.get(milestone.parentId) : undefined;
    if (parent) {
      parent.childrenMilestones.push(milestone);
    } else {
      roots.push(milestone);
    }
  }

  const sortByOrder = (items: WithChildren<T>[]) => {
    items.sort((a, b) => a.order - b.order);
    items.forEach((item) => sortByOrder(item.childrenMilestones));
  };
  sortByOrder(roots);

  return roots;
}

/**
 * Group root milestones by the stage they belong to.
 *
 * Grouping happens on ROOTS, not on the flat list, and that distinction is
 * load-bearing: a sub-activity can carry a different `projectStage` from its
 * parent (the template has one — "Termite Guys Book to Glue" is tagged Lockup
 * but hangs off a Frame inspection). Grouping flat would file that activity
 * under Lockup while the tab, which groups roots, files it under Frame — and a
 * stage that looks complete on screen but not to the invoice generator is a
 * claim that never gets raised. One grouping, used by both.
 */
export function groupRootsByStage<T extends TreeMilestone>(
  roots: readonly WithChildren<T>[],
): Partial<Record<ProjectStage, WithChildren<T>[]>> {
  const grouped: Partial<Record<ProjectStage, WithChildren<T>[]>> = {};

  for (const root of roots) {
    (grouped[root.projectStage] ??= []).push(root);
  }

  return grouped;
}
