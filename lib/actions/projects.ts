"use server";

import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
import { getAllProjectsForExport as readAllProjectsForExport } from "@/lib/data/projects";
import {
  createProjectWithLead,
  type CreateProjectWithLeadInput,
} from "@/lib/data/projectsWrite";
import {
  createProjectFailure,
  failureFromThrownError,
  type CreateProjectResult,
} from "@/lib/projects/create-project-errors";
import type { ProjectWithStats } from "@/types/project";

/**
 * Result-returning wrapper around {@link createProjectWithLead} for client
 * callers (the create-project wizard).
 *
 * `createProjectWithLead` communicates failure by throwing, which is right for
 * server-to-server callers such as the offer handoff but useless across the
 * server-action boundary: Next replaces a thrown message with an opaque digest
 * in production, and `ProjectDateBlockerError` arrives as a bare object with
 * neither its prototype nor its `blockers` array. This wrapper converts the
 * throw into a serializable {@link CreateProjectResult} so the wizard can bind
 * each problem to the form field that caused it.
 *
 * Never throws for an expected failure — inspect `result.ok` instead.
 */
export async function createProjectWithLeadAction(
  input: CreateProjectWithLeadInput,
): Promise<CreateProjectResult> {
  // The lead id comes from the browser, and converting a lead writes a
  // customer, a project and its milestones (and spends an inference when there
  // is no extraction). Anyone who can reach this endpoint could otherwise do
  // that to a lead they cannot open.
  if (!Number.isSafeInteger(input?.leadId)) {
    return {
      ok: false,
      failure: createProjectFailure(
        "VALIDATION",
        "Select a lead",
        "Select a lead before creating the project.",
        { fieldErrors: [{ field: "lead", message: "Select a lead." }] },
      ),
    };
  }
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return {
      ok: false,
      failure: createProjectFailure(
        "FORBIDDEN",
        "You cannot create a project from this lead",
        access.error,
        {
          fieldErrors: [{ field: "lead", message: access.error }],
          retryable: false,
        },
      ),
    };
  }

  try {
    const project = await createProjectWithLead(input);
    return { ok: true, project };
  } catch (error) {
    // `createProjectWithLead` already logged the raw error with its stack.
    return { ok: false, failure: failureFromThrownError(error) };
  }
}

/**
 * Every project with its milestones, budget and invoices, for the projects
 * page's export. Staff only: the export spans every customer, and
 * lib/data/projects.ts, which reads it, is server-only and checks nobody.
 */
export async function getAllProjectsForExport(): Promise<ProjectWithStats[]> {
  const access = await requireInternalUser();
  if (!access.ok) {
    // Thrown to keep the signature the export button uses; its catch shows the
    // failure, and staff never reach this.
    throw new Error(access.error);
  }
  return readAllProjectsForExport();
}
