import "server-only";

import { after } from "next/server";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { createProjectUpdate as createProjectUpdateCommand } from "@/lib/domain/projects/resources";
import { triggerNotification } from "@/lib/notification/novu";
import { CACHE_PROFILES } from "@/types/cache";
import { createNotification } from "@/types/notification";
import type { CreateProjectUpdateInput } from "@/utils/validators";

/**
 * The Next adapter over
 * `lib/domain/projects/resources.ts#createProjectUpdate`.
 *
 * The site-update row, its activity entry and the milestone it completes are
 * one transaction in the command — they used to be a transaction that wrote
 * two of the three and an `after()` that did the rest. The notification and
 * the cache tag are genuinely post-commit and stay here.
 *
 * `authorId` is no longer a parameter: the command resolves the author from
 * the principal, so a caller cannot post an update in somebody else's name.
 */
export async function createProjectUpdate(
  input: { projectId: string } & CreateProjectUpdateInput,
) {
  const { projectId, milestoneId, notes, photoUrls = [] } = input;
  const principal = await currentPrincipal();

  const outcome = await prisma.$transaction((tx) =>
    createProjectUpdateCommand(
      principal,
      { milestoneId, notes, photoUrls, projectId },
      tx,
    ),
  );

  after(async () => {
    if (outcome.completedMilestone) {
      await triggerNotification(
        outcome.siteManagerId ? [outcome.siteManagerId] : [],
        createNotification("projectSiteUpdates", {
          milestoneName: outcome.completedMilestone.name,
          projectId: outcome.projectId,
          projectName: outcome.projectName,
          updateNote: notes,
        }),
      );
    }

    revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
  });

  return {
    milestoneWasPhotoRequired: Boolean(outcome.completedMilestone),
  };
}
