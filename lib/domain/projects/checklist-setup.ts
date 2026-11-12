import type { DomainDb } from "../db";
import {
  CHECKLIST_COUNT,
  checklistDefinition,
  templateItems,
} from "./checklist-templates";

// Creating a project's six stage checklists (issue #420).

/**
 * Make sure all six checklists exist for this project, with the handover rows
 * copied onto the sixth. Idempotent: the unique keys make a second call, or
 * two tabs opening the tab at once, a no-op rather than a duplicate.
 *
 * Projects predate checklists, so this runs when the checklists are first
 * read rather than when the project was created.
 */
export async function ensureProjectChecklists(
  projectId: string,
  db: DomainDb,
): Promise<void> {
  const existing = await db.projectChecklist.findMany({
    select: {
      _count: { select: { items: true } },
      id: true,
      number: true,
      templateKey: true,
    },
    where: { projectId },
  });

  const missing = Array.from({ length: CHECKLIST_COUNT }, (_, index) =>
    checklistDefinition(index + 1),
  ).filter(
    (definition) => !existing.some((row) => row.number === definition.number),
  );
  let rows = existing;
  if (missing.length > 0) {
    await db.projectChecklist.createMany({
      data: missing.map((definition) => ({
        number: definition.number,
        projectId,
        stage: definition.stage,
        templateKey: definition.templateKey,
        title: definition.title,
      })),
      skipDuplicates: true,
    });
    rows = await db.projectChecklist.findMany({
      select: {
        _count: { select: { items: true } },
        id: true,
        number: true,
        templateKey: true,
      },
      where: { projectId },
    });
  }

  for (const row of rows) {
    const template = templateItems(row.templateKey);
    if (template.length === 0 || row._count.items >= template.length) continue;
    await db.checklistItem.createMany({
      data: template.map((item) => ({
        checklistId: row.id,
        key: item.key,
        label: item.label,
        order: item.order,
        section: item.section,
        sectionOrder: item.sectionOrder,
      })),
      skipDuplicates: true,
    });
  }
}
