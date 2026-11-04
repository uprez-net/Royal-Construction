"use server";

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { createProjectWithLead } from "@/lib/data/projectsWrite";
import {
  handOffOfferToProject,
  type ProjectHandoffResult,
} from "@/lib/offer/sends/project-handoff";

// Convert a CONTRACT_SIGNED offer into a Project. The work is
// lib/offer/sends/project-handoff.ts, which Eve calls too; this is the Clerk
// check, project creation through the app's adapter, and the cache expiry.
export async function createProjectFromOffer(input: {
  offerId: string;
}): Promise<ProjectHandoffResult> {
  // The same gate as the send actions: signed in, and allowed this offer's
  // lead. prepareProjectHandoff checks the lead again inside the handoff.
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  return handOffOfferToProject(access.user, input, prisma, {
    createProject: async (projectInput) => {
      const project = await createProjectWithLead(projectInput);
      return {
        projectId: (project as { id: string }).id,
        milestoneCount: project.milestones.length,
      };
    },
    handedOff: (offerId, projectId) => {
      revalidateTag(`offer-${offerId}`, CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
    },
  });
}
