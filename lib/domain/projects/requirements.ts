import type { Prisma } from "@prisma/client";

import type { ProjectRequirementsPayload } from "@/types/project-flow";

import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainValidationError,
} from "../errors";

// The structured requirements payload: what a complete one looks like, how a
// partial patch merges into one, and the optimistic write that saves it.
//
// This was Eve-only (`updateProjectRequirementsDirect`), and the survey note in
// the migration TODO called it "a single implementation already". That was
// true of the *write*. It was not true of the rules around it:
//
//   - `app/api/(data)/projects/[projectId]/route.ts` PATCHes `requirements`
//     too, from the project Overview tab, with no shape check beyond its Zod
//     schema and **no optimistic concurrency at all** — a blind
//     `project.update`. Two tabs open on the Overview, or one tab retried after
//     a timeout, and the second save silently overwrote the first. That is the
//     single-user concurrency bug that matters here: it does not need two
//     people, only two tabs.
//   - Eve required `expectedUpdatedAt` and refused a stale write.
//
// One command now, with the stricter rule, so a save from either channel is
// rejected rather than silently landing on top of somebody's edit.

const REQUIREMENT_SECTIONS = [
  "legalAdministration",
  "commercialsAndClaims",
  "subStructureAndGround",
  "inclusionsAndExclusions",
  "utilityInfrastructure",
  "wetAreaCompliance",
  "safetyAndSiteLogistics",
] as const;

export type ProjectRequirementsSection = (typeof REQUIREMENT_SECTIONS)[number];

export const projectRequirementsSections: readonly ProjectRequirementsSection[] =
  REQUIREMENT_SECTIONS;

/**
 * Is this a complete, versioned requirements payload?
 *
 * Structural, not a schema parse: the payload is persisted as JSON and read
 * back as `unknown`, and a project created before a section existed genuinely
 * has an incomplete one. A caller gets "this project has no complete payload"
 * rather than a merge that quietly drops a section.
 */
export function isCompleteProjectRequirements(
  value: unknown,
): value is ProjectRequirementsPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (
    raw.version !== 1
    || typeof raw.projectName !== "string"
    || typeof raw.projectType !== "string"
    || typeof raw.summary !== "string"
  ) {
    return false;
  }
  if (
    !raw.sourceDocuments
    || typeof raw.sourceDocuments !== "object"
    || !Array.isArray(raw.validations)
    || !Array.isArray(raw.conflicts)
  ) {
    return false;
  }
  if (!raw.automationTriggers || typeof raw.automationTriggers !== "object") {
    return false;
  }
  const triggers = raw.automationTriggers as Record<string, unknown>;
  if (
    !["orderReminders", "rainDelayCalculations", "noticeCountdowns"].every(
      (key) => typeof triggers[key] === "boolean",
    )
  ) {
    return false;
  }
  return REQUIREMENT_SECTIONS.every(
    (section) =>
      raw[section] !== null
      && typeof raw[section] === "object"
      && !Array.isArray(raw[section]),
  );
}

/**
 * Deep-merge a partial patch into the stored payload.
 *
 * Objects merge key by key; anything else (including an array) replaces
 * wholesale, because a partial array merge has no meaning for an inclusions
 * list — "replace the inclusions" is the only thing a caller can mean.
 */
export function mergeProjectRequirementsPatch(
  current: ProjectRequirementsPayload,
  patch: Record<string, unknown>,
): ProjectRequirementsPayload {
  const merge = (base: unknown, next: unknown): unknown => {
    if (
      !base
      || typeof base !== "object"
      || Array.isArray(base)
      || !next
      || typeof next !== "object"
      || Array.isArray(next)
    ) {
      return next;
    }
    const output = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(
      next as Record<string, unknown>,
    )) {
      output[key] = merge(output[key], value);
    }
    return output;
  };

  return Object.entries(patch).reduce(
    (result, [key, value]) => {
      result[key] = merge(result[key], value);
      return result;
    },
    { ...current } as unknown as Record<string, unknown>,
  ) as unknown as ProjectRequirementsPayload;
}

export type ProjectRequirementsRead = {
  readonly projectId: string;
  readonly updatedAt: string;
  readonly requirements: ProjectRequirementsPayload;
};

/**
 * The stored payload plus the `updatedAt` a later save must quote back.
 *
 * Returning the version alongside the value is the point: a caller that reads
 * the requirements and then saves them has everything it needs to prove it was
 * looking at the row it is about to overwrite.
 */
export async function getProjectRequirements(
  projectId: string,
  db: DomainDb,
): Promise<ProjectRequirementsRead> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, requirements: true, updatedAt: true },
  });
  if (!project) throw new DomainNotFoundError("Project not found");
  if (!isCompleteProjectRequirements(project.requirements)) {
    throw new DomainValidationError(
      "This project has no complete structured requirements payload.",
      "requirements",
    );
  }
  return {
    projectId: project.id,
    requirements: project.requirements,
    updatedAt: project.updatedAt.toISOString(),
  };
}

export type UpdateProjectRequirementsInput = {
  readonly projectId: string;
  readonly patch: Record<string, unknown>;
  /** The `updatedAt` the caller read, ISO-8601. */
  readonly expectedUpdatedAt: string;
};

export type UpdateProjectRequirementsResult = {
  readonly projectId: string;
  readonly updatedAt: string;
  readonly changedSections: readonly string[];
};

/**
 * Apply a patch to a project's requirements, refusing a stale write.
 *
 * Authorization is the caller's: both channels resolve the project through
 * `authorizeProject` first, and this command is also reachable inside that
 * transaction. It owns the shape rule and the version check.
 */
export async function updateProjectRequirements(
  input: UpdateProjectRequirementsInput,
  db: DomainDb,
): Promise<UpdateProjectRequirementsResult> {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new DomainValidationError(
      "expectedUpdatedAt must be an ISO-8601 timestamp read from this project.",
      "expectedUpdatedAt",
    );
  }

  const current = await db.project.findUnique({
    where: { id: input.projectId },
    select: { requirements: true, updatedAt: true },
  });
  if (!current) throw new DomainNotFoundError("Project not found");

  if (!isCompleteProjectRequirements(current.requirements)) {
    throw new DomainValidationError(
      "The current project requirements payload is incomplete and cannot be safely patched.",
      "requirements",
    );
  }

  const candidate = mergeProjectRequirementsPatch(
    current.requirements,
    input.patch,
  );
  if (!isCompleteProjectRequirements(candidate)) {
    throw new DomainValidationError(
      "The update must preserve every required requirements section and the versioned payload shape.",
      "requirements",
    );
  }

  const updated = await db.project.updateMany({
    where: { id: input.projectId, updatedAt: expectedUpdatedAt },
    data: { requirements: candidate as unknown as Prisma.InputJsonValue },
  });

  if (updated.count !== 1) {
    throw new DomainStaleVersionError(
      "The project changed since you read it. Reload the requirements and try again.",
    );
  }

  const saved = await db.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { updatedAt: true },
  });

  return {
    changedSections: Object.keys(input.patch),
    projectId: input.projectId,
    updatedAt: saved.updatedAt.toISOString(),
  };
}
