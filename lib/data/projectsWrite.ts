import "server-only";

import { after } from "next/server";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getCachedProjectById } from "@/lib/data/projects";
import { handleProjectSpecsGeneration } from "@/lib/agent/projectCreationAgent";
import { createLeadProjectInferencePrompt } from "@/lib/agent/project-prompt";
import { LEAD_NOTES_HISTORY_INCLUDE } from "@/lib/leads/notes-text";
import {
  createProjectFromLead,
  type CreateProjectFromLeadInput,
} from "@/lib/domain/projects/creation";
import type { ProjectInferencePort } from "@/lib/domain/ports/project-inference";
import { triggerNotification } from "@/lib/notification/novu";
import { getXeroContext, XeroNotConnectedError } from "@/lib/xero/client";
import { resolveProjectXeroContactId } from "@/lib/xero/contact";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import type { ProjectDetail } from "@/types/project";

// The Next adapter over `lib/domain/projects/creation.ts`.
//
// The conversion itself — the lead guard, the site-manager check, the customer
// resolution, the requirements payload, the readiness gate, the milestones,
// the activity entry and moving the lead's files onto the project — is one
// domain command running in one transaction. This file supplies the three
// things it cannot have: the AI inference port, the cache tags, the Novu
// notification, and the project's Xero contact.
//
// `createProject` (the deprecated manual path that deliberately failed by
// writing `leadId: 0`) is gone. It had no caller, its only effect on a real
// database was a foreign-key violation, and the one route that reached it
// answers through this path now.

/** The lead-inference model, as the port the domain takes. */
const inferProjectSpecs: ProjectInferencePort = async ({ leadId }) => {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      // Sales notes reach the inference prompt through here when the Notes
      // composer has cleared the lead's own columns, which it does on every
      // save. Without them the prompt says "No notes available." and the
      // project is inferred from the contact details alone.
      history: LEAD_NOTES_HISTORY_INCLUDE,
    },
  });
  if (!lead) return null;

  const specs = await handleProjectSpecsGeneration(
    createLeadProjectInferencePrompt(lead),
  );
  if (!specs) return null;

  return {
    projectBudget: specs.projectBudget,
    projectDescription: specs.projectDescription,
    projectType: specs.projectType,
  };
};

export type { CreateProjectFromLeadInput as CreateProjectWithLeadInput };

/**
 * Convert a lead into a project and answer with the project detail payload.
 *
 * Authorizes nobody: the caller must already have checked that the signed-in
 * user may open `leadId`. The browser reaches it only through
 * `createProjectWithLeadAction` in `lib/actions/projects.ts`, which does.
 *
 * Failures arrive as `DomainError` subclasses now, not as `Error`s carrying a
 * sentinel string in their message. `lib/projects/create-project-errors.ts`
 * maps them onto the wizard's fields.
 */
export async function createProjectWithLead(
  input: CreateProjectFromLeadInput,
): Promise<ProjectDetail> {
  const principal = await currentPrincipal();

  const created = await prisma.$transaction(
    (tx) => createProjectFromLead(principal, input, tx, { inferProjectSpecs }),
    // The conversion writes a customer, a project, its whole milestone
    // template and an activity entry, and the inference call that may precede
    // it is already done by here. The default 5s interactive timeout is not
    // enough for the template insert on a cold connection.
    { timeout: 30_000 },
  );

  // The customer was created or updated INSIDE the transaction above, so its
  // invalidation is deferred to here — firing it pre-commit let another
  // request refill the "customers" cache from uncommitted data with nothing to
  // correct it afterwards (PR #124 review). Runs before the detail read so the
  // tag is cleared even if that read fails.
  revalidateTag("customers", CACHE_PROFILES.MEDIUM);

  const detail = await getCachedProjectById(created.projectId);
  if (!detail) {
    throw new Error(
      `Project was created but could not be retrieved for lead ID ${input.leadId}.`,
    );
  }

  after(async () => {
    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${created.projectId}`, CACHE_PROFILES.MEDIUM);

    await ensureProjectXeroContact(created.projectId);

    await triggerNotification(
      created.siteManagerId ? [created.siteManagerId] : [],
      createNotification("projectCreated", {
        customerEmail: created.customer.email,
        customerName: created.customers.map((owner) => owner.name).join(" & "),
        customerPhone: created.customer.phone ?? "Not specified",
        location: created.location,
        projectId: created.projectId,
        projectName: created.projectName,
        projectType: created.projectType,
      }),
    );
  });

  return detail;
}

/**
 * Create the project's Xero contact now, while the owners are fresh, so the
 * bookkeeper sees the contact before the first claim rather than with it.
 *
 * After commit and outside the transaction on purpose: a Xero outage must not
 * roll back a project the office has just reviewed. Nothing is lost when it
 * fails — the first progress claim resolves the same contact the same way
 * (`resolveProjectXeroContactId` is idempotent), and a failure there is
 * reported on the claim, where somebody is looking.
 */
async function ensureProjectXeroContact(projectId: string): Promise<void> {
  try {
    const context = await getXeroContext();
    await resolveProjectXeroContactId(context, projectId);
  } catch (error) {
    if (error instanceof XeroNotConnectedError) {
      console.info(
        `[xero] No organisation connected; the contact for project ${projectId} will be created with its first claim.`,
      );
      return;
    }
    console.error(
      `[xero] Could not create the contact for project ${projectId}; its first claim will try again:`,
      error,
    );
  }
}
