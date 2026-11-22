import { MilestoneStatus, Prisma } from "@prisma/client";

import type { SafeMaterial } from "@/types/project";

import {
  authorizeProject,
  authorizeProjectRecording,
  canSeeProjectFinancials,
} from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import { requireUserPrincipal, type DomainPrincipal } from "../principal";

// The two smaller project resources: materials, and the site updates a site
// manager posts from the field.
//
// Neither had a caller check. `app/api/(data)/material/route.ts` took a
// `projectId` out of the body and wrote a material row against it; the site
// update route resolved the signed-in user but never asked whether that user
// may post to the project named in the URL. Both go through
// `authorizeProject` now — the same rule the milestone and variation commands
// use, rather than a third spelling.

export type AddMaterialInput = {
  readonly projectId: string;
  readonly name: string;
  readonly category: string;
  readonly specifications?: string | null;
  readonly quantity: number;
  readonly unitCost: number;
  readonly totalCost: number;
};

/** Record a material against a project. */
export async function addMaterialToProject(
  principal: DomainPrincipal,
  input: AddMaterialInput,
  db: DomainDb,
): Promise<SafeMaterial> {
  // Materials carry a unit and total cost, so they are the office's figures
  // (`canSeeProjectFinancials`). No screen a site manager can reach offers this
  // form: `AddMaterialModal` is registered in modal-manager but nothing opens
  // it. Refused before any read, so a forged POST writes nothing.
  if (!canSeeProjectFinancials(principal)) {
    throw new DomainAuthorizationError("Materials are costed by the office.");
  }
  await authorizeProject(principal, input.projectId, db);

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new DomainValidationError(
      "Quantity must be a positive number.",
      "quantity",
    );
  }
  for (const [field, value] of [
    ["unitCost", input.unitCost],
    ["totalCost", input.totalCost],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainValidationError(
        `${field} must be a non-negative number.`,
        field,
      );
    }
  }

  const material = await db.material.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      category: input.category,
      specifications: input.specifications ?? undefined,
      quantity: input.quantity,
      unitCost: new Prisma.Decimal(input.unitCost),
      totalCost: new Prisma.Decimal(input.totalCost),
    },
  });

  return {
    ...material,
    unitCost: material.unitCost.toString(),
    totalCost: material.totalCost.toString(),
  };
}

export type CreateProjectUpdateInput = {
  readonly projectId: string;
  readonly milestoneId?: string | null;
  readonly notes: string;
  readonly photoUrls?: readonly string[];
};

export type ProjectUpdateOutcome = {
  readonly projectId: string;
  readonly projectName: string;
  readonly milestoneId: string | null;
  /**
   * The milestone this update completed, when the milestone required a photo
   * and now has one. Null otherwise — posting an update is not by itself a
   * statement that the activity is finished.
   */
  readonly completedMilestone: {
    readonly id: string;
    readonly name: string;
  } | null;
  readonly siteManagerId: string | null;
};

/**
 * Post a site update, and settle the milestone it completes.
 *
 * A milestone flagged `isPhotoRequired` is DONE once an update lands on it:
 * the photo is the evidence the activity asked for. The site-update row, its
 * activity-log entry and that settlement are one transaction — a photo
 * recorded without the completion it justifies, or a completion with no
 * evidence behind it, are both worse than the whole thing failing.
 *
 * **The milestone is now required to belong to the project.** The previous
 * implementation looked the milestone up by id alone and wrote the
 * `siteUpdate` with whatever `projectId` it was handed alongside, so a
 * mismatched pair marked another project's milestone done.
 */
export async function createProjectUpdate(
  principal: DomainPrincipal,
  input: CreateProjectUpdateInput,
  db: DomainDb,
): Promise<ProjectUpdateOutcome> {
  // A site update (notes, photos) is site recording: any site manager, every
  // project (`canRecordOnProject`).
  const project = await authorizeProjectRecording(
    principal,
    input.projectId,
    db,
  );

  const notes = input.notes?.trim() ?? "";
  const photoUrls = [...(input.photoUrls ?? [])];
  if (!notes && photoUrls.length === 0) {
    throw new DomainValidationError(
      "A site update needs a note or a photo.",
      "notes",
    );
  }

  const milestoneId = input.milestoneId?.trim() || null;
  const milestone = milestoneId
    ? await db.milestone.findFirst({
        where: { id: milestoneId, projectId: input.projectId },
        select: { id: true, isPhotoRequired: true, name: true, status: true },
      })
    : null;

  if (milestoneId && !milestone) {
    throw new DomainNotFoundError(
      "That milestone does not belong to this project.",
    );
  }

  // `SiteUpdate.authorId` is non-null in the schema: a site update is
  // somebody's report from the field, so a cron or the public route has no
  // business posting one. Refused explicitly rather than failing on the
  // foreign key halfway through the transaction.
  const { userId: authorId } = requireUserPrincipal(principal);

  await db.siteUpdate.create({
    data: {
      projectId: input.projectId,
      milestoneId,
      authorId,
      notes,
      photoUrls,
    },
  });

  await logActionOrThrow(
    {
      authorId,
      message: `Site update posted for ${project.name}`,
      milestoneId,
      projectId: input.projectId,
      timestamp: new Date(),
      type: "site-update",
    },
    db,
  );

  let completedMilestone: ProjectUpdateOutcome["completedMilestone"] = null;

  if (milestone?.isPhotoRequired && milestone.status !== MilestoneStatus.DONE) {
    await db.milestone.update({
      where: { id: milestone.id },
      data: { status: MilestoneStatus.DONE, actualDate: new Date() },
    });
    completedMilestone = { id: milestone.id, name: milestone.name };
  }

  return {
    completedMilestone,
    milestoneId,
    projectId: input.projectId,
    projectName: project.name,
    siteManagerId: project.siteManagerId,
  };
}
