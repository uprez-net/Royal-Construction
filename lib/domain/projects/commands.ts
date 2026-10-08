import { Prisma } from "@prisma/client";

import { createActivityLogEntry } from "@/types/activityLog";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import { normalizeDateString } from "@/utils/date";

import { authorizeProject, authorizeProjectEdit } from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import type { DomainDb } from "../db";
import { DomainStaleVersionError, DomainValidationError } from "../errors";
import { requireAssignableSiteManager } from "../identity/site-managers";
import {
  attributionUserId,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";

import { STARTED_MILESTONE_STATUSES } from "./milestone-schedule";
import { rescheduleProjectFromStart } from "./milestones";
import {
  collectProjectDateBlockers,
  partitionBlockers,
  ProjectDateBlockerError,
} from "./readiness";

// Editing a project's own fields.
//
// The rule used to live entirely inside `app/api/(data)/projects/[projectId]/route.ts`:
// its own access check, its own merge of the incoming requirements with the
// persisted ones, its own readiness gate, and a blind `project.update`. Eve has
// no equivalent tool today, so this is not a reconciliation of two copies — it
// is the same move `lib/domain/projects/requirements.ts` makes, for the same
// reason: the next caller (an Eve tool, the offer handoff, a cron correcting a
// date) gets the gate rather than writing a second one.

export type UpdateProjectInput = {
  readonly projectId: string;
  readonly name?: string;
  readonly location?: string;
  readonly council?: string;
  readonly description?: string | null;
  readonly startDate?: string;
  readonly estimatedEndDate?: string;
  readonly totalBudget?: number;
  readonly requirements?: Record<string, unknown>;
};

export type UpdateProjectResult = {
  readonly projectId: string;
  /** Blockers that did not stop the save but the header should still show. */
  readonly warnings: readonly string[];
  /** Activities re-dated because the start date moved; 0 when it did not. */
  readonly rescheduledMilestones: number;
};

type PersistedLegalAdministration = {
  signedDate?: string | null;
  pcaInspector?: string | null;
  hbcfInsuranceNumber?: string | null;
};

/**
 * Apply an operator's edits to a project, refusing an impossible date pair.
 *
 * The readiness gate runs against the **effective post-update state**, not the
 * patch fragment: a PATCH that sends only `requirements` (what the Overview tab
 * does) or only `startDate` still has to be compared against the values already
 * stored, or a start date moved before an untouched signed date sails through.
 */
export async function updateProject(
  principal: DomainPrincipal,
  input: UpdateProjectInput,
  db: DomainDb,
): Promise<UpdateProjectResult> {
  await authorizeProjectEdit(principal, input.projectId, db);

  const existing = await db.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { requirements: true, startDate: true, status: true },
  });

  const persisted = (existing.requirements ?? {}) as {
    legalAdministration?: PersistedLegalAdministration;
  };
  const merged = input.requirements
    ? { ...persisted, ...input.requirements }
    : persisted;
  const legal = (
    merged as { legalAdministration?: PersistedLegalAdministration }
  ).legalAdministration;

  const rawSignedDate = legal?.signedDate ?? null;
  const effectiveSignedDate = rawSignedDate
    ? (normalizeDateString(rawSignedDate) ?? rawSignedDate)
    : null;

  const effectiveStartDate =
    input.startDate ?? existing.startDate.toISOString();

  const blockers = collectProjectDateBlockers({
    hbcfInsuranceNumber: legal?.hbcfInsuranceNumber ?? null,
    pcaInspector: legal?.pcaInspector ?? null,
    signedDate: effectiveSignedDate,
    startDate: effectiveStartDate,
    status: existing.status,
  });
  const { blocks, warns } = partitionBlockers(blockers);

  if (blocks.length > 0) throw new ProjectDateBlockerError(blocks);

  for (const [field, value] of [
    ["startDate", input.startDate],
    ["estimatedEndDate", input.estimatedEndDate],
  ] as const) {
    if (value !== undefined && Number.isNaN(new Date(value).getTime())) {
      throw new DomainValidationError(
        `${field} is not a calendar date.`,
        field,
      );
    }
  }

  // Compared by instant, so re-sending the stored date — a form saving its
  // other fields — never rewrites a schedule nobody asked to move.
  const nextStartDate = input.startDate ? new Date(input.startDate) : null;
  const startDateMoved =
    nextStartDate !== null
    && nextStartDate.getTime() !== existing.startDate.getTime();

  // Once an activity has started, the start date is the day work began — set
  // by `updateMilestone` — and moving it would re-date a schedule already under
  // way. Refused for every caller, not just hidden on the Overview tab.
  if (startDateMoved) {
    const started = await db.milestone.count({
      where: {
        projectId: input.projectId,
        status: { in: STARTED_MILESTONE_STATUSES },
      },
    });
    if (started > 0) {
      throw new DomainValidationError(
        "The start date can't be changed once work has started. It was set to the day the first milestone started.",
        "startDate",
      );
    }
  }

  const writeProjectFields = (tx: DomainDb) =>
    tx.project.update({
      where: { id: input.projectId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.location ? { location: input.location } : {}),
        ...(input.council !== undefined ? { council: input.council } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
        ...(input.estimatedEndDate
          ? { estimatedEndDate: new Date(input.estimatedEndDate) }
          : {}),
        ...(input.totalBudget !== undefined
          ? { totalBudget: new Prisma.Decimal(input.totalBudget) }
          : {}),
        ...(input.requirements !== undefined
          ? {
              requirements:
                input.requirements as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });

  const write = async (tx: DomainDb): Promise<number> => {
    await writeProjectFields(tx);
    if (!startDateMoved || !nextStartDate) return 0;

    // Every activity's target date hangs off the start, so moving it moves
    // the schedule — in this transaction, or the project would show a new
    // start against the old dates.
    return rescheduleProjectFromStart(
      principal,
      {
        previousStartDate: existing.startDate,
        projectId: input.projectId,
        startDate: nextStartDate,
      },
      tx,
    );
  };

  // A caller already inside a transaction hands in its own client, which has
  // no `$transaction`. Rewriting every activity is one update per row, so the
  // default five-second interactive window is too tight on a full template.
  const rescheduledMilestones =
    startDateMoved && "$transaction" in db
      ? await db.$transaction(write, { timeout: 30_000 })
      : await write(db);

  return {
    projectId: input.projectId,
    rescheduledMilestones,
    warnings: warns.map((warn) => warn.label),
  };
}

export type AssignProjectSiteManagerResult = {
  readonly projectId: string;
  readonly siteManagerId: string;
  readonly previousSiteManagerId: string | null;
  /** False when the project already had this site manager; nothing was written. */
  readonly changed: boolean;
};

/**
 * Hand a project to a different site manager.
 *
 * ADMIN only, not `canEditProject`: a site manager who may edit a project's
 * fields may not give the project to someone else — or take one that is not
 * theirs. The new holder is checked with the same `requireAssignableSiteManager`
 * project creation uses, so a GUEST or a customer account cannot be handed a
 * build through this door either.
 *
 * The read, the change and its history entry are one transaction, and the
 * change is conditional on the manager it was decided against. A double-click
 * or a retry after a timeout — one person, two requests — then finds the
 * project already moved and is refused, rather than writing the change and
 * its history row twice.
 */
export async function assignProjectSiteManager(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly siteManagerId: string },
  db: DomainDb,
): Promise<AssignProjectSiteManagerResult> {
  requireAdminPrincipal(principal);

  const run = async (tx: DomainDb): Promise<AssignProjectSiteManagerResult> => {
    const project = await authorizeProject(principal, input.projectId, tx);
    const siteManager = await requireAssignableSiteManager(
      input.siteManagerId,
      tx,
    );

    const result = {
      previousSiteManagerId: project.siteManagerId,
      projectId: project.id,
      siteManagerId: siteManager.id,
    };
    if (project.siteManagerId === siteManager.id) {
      return { ...result, changed: false };
    }

    const previous = project.siteManagerId
      ? await tx.user.findUnique({
          select: { name: true },
          where: { id: project.siteManagerId },
        })
      : null;

    const updated = await tx.project.updateMany({
      data: { siteManagerId: siteManager.id },
      where: { id: project.id, siteManagerId: project.siteManagerId },
    });
    if (updated.count !== 1) {
      throw new DomainStaleVersionError(
        "The site manager changed while this was being saved. Refresh and try again.",
      );
    }
    // Throwing, not the forgiving logAction: inside a transaction a failed
    // insert aborts the commit anyway, and the history row is part of what
    // this change promises.
    await logActionOrThrow(
      {
        ...createActivityLogEntry("siteManagerAssigned", {
          previousSiteManagerName: previous?.name ?? null,
          projectId: project.id,
          siteManagerName: siteManager.name,
        }),
        authorId: attributionUserId(principal),
      },
      tx,
    );

    return { ...result, changed: true };
  };

  // A caller already inside a transaction (an Eve tool's audited operation)
  // hands in its own client, which has no `$transaction` of its own.
  return "$transaction" in db ? db.$transaction(run) : run(db);
}

/**
 * Normalize the free-text signed date inside a requirements payload, in place
 * of a copy, and answer with the payload the caller should persist.
 *
 * The signed date arrives from OCR extraction, so it is normalized to a
 * canonical `YYYY-MM-DD` before it reaches the database. When parsing fails the
 * raw string is kept rather than discarded: the header can render it with the
 * "unverified" marker, and `signed_date_unparseable` tells the operator why.
 */
export function withNormalizedSignedDate(
  requirements: ProjectRequirementsPayload,
): ProjectRequirementsPayload {
  const payload = requirements as ProjectRequirementsPayload & {
    legalAdministration: { signedDate: string | null };
  };
  const raw = payload.legalAdministration?.signedDate ?? null;
  if (!raw) return requirements;

  return {
    ...payload,
    legalAdministration: {
      ...payload.legalAdministration,
      signedDate: normalizeDateString(raw) ?? raw,
    },
  };
}
