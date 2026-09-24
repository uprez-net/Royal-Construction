import "server-only";

import { after } from "next/server";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { logAction } from "@/lib/domain/audit/action-log";
import { attributionUserId } from "@/lib/domain/principal";
import {
  createVariation as createVariationCommand,
  decideVariation,
  type VariationDecision,
} from "@/lib/domain/projects/variations";
import { triggerNotification } from "@/lib/notification/novu";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import type { CreateVariationInput } from "@/utils/validators";
import { currency } from "@/utils/formatters";

// The Next adapter over `lib/domain/projects/variations.ts`.
//
// The rule — who may decide a variation, that it belongs to the project in the
// URL, that a decided one cannot be decided again, and what an approval does
// to the remaining programme — is in the domain. Notifications, the activity
// entry and the cache tag are post-commit work and stay here.

export async function createVariation(
  projectId: string,
  input: CreateVariationInput,
) {
  const principal = await currentPrincipal();

  const variation = await createVariationCommand(
    principal,
    {
      cost: input.cost,
      description: input.description,
      projectId,
      requestedDate: input.requestedDate,
    },
    prisma,
  );

  after(async () => {
    await logAction(
      {
        ...createActivityLogEntry("variationCreated", {
          projectId: variation.projectId,
          projectName: variation.projectName,
          variationAmount: currency.format(Number(variation.cost)),
          variationDescription: variation.description,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );
    await triggerNotification(
      variation.siteManagerId ? [variation.siteManagerId] : [],
      createNotification("variationCreated", {
        projectId: variation.projectId,
        projectName: variation.projectName,
        variationAmount: variation.cost,
        variationDescription: variation.description,
      }),
    );
    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return variation;
}

/**
 * Approve or reject a variation.
 *
 * `projectId` is required now: the route has it in its own URL, and the
 * previous signature took only the variation id, so nothing checked the two
 * matched or that the caller could manage the project.
 */
export async function updateVariationStatus(
  projectId: string,
  variationId: string,
  status: VariationDecision,
) {
  const principal = await currentPrincipal();

  const outcome = await decideVariation(
    principal,
    { decision: status, projectId, variationId },
    prisma,
  );

  after(async () => {
    await logAction(
      {
        ...createActivityLogEntry("variationUpdated", {
          projectId: outcome.projectId,
          projectName: outcome.projectName,
          status: outcome.status,
          variationAmount: currency.format(Number(outcome.cost)),
          variationDescription: outcome.description,
        }),
        authorId: attributionUserId(principal),
      },
      prisma,
    );
    await triggerNotification(
      outcome.siteManagerId ? [outcome.siteManagerId] : [],
      createNotification("variationUpdated", {
        projectId: outcome.projectId,
        projectName: outcome.projectName,
        status: outcome.status,
        variationAmount: outcome.cost,
        variationDescription: outcome.description,
      }),
    );
    revalidateTag(`project-${outcome.projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return outcome;
}
