import { revalidateTag } from "next/cache";

import { milestoneTemplateSnapshotSchema } from "@/lib/validations/milestone-template";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  readMilestoneTemplate,
  saveMilestoneTemplateWithEffects,
} from "@/lib/domain/projects/templates";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  errorResponse,
  successResponse,
  validationErrorResponse,
} from "@/utils/validators/response";

export async function GET() {
  try {
    return successResponse(
      await readMilestoneTemplate(await currentPrincipal(), prisma),
    );
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Build sequence read failed", error);
    return errorResponse("Could not load the build sequence.", { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const principal = await currentPrincipal();
    const body = await request.json().catch(() => null);
    const input = milestoneTemplateSnapshotSchema.safeParse(body);
    if (!input.success) return validationErrorResponse(input.error);
    const { template, affectedProjectIds } =
      await saveMilestoneTemplateWithEffects(principal, input.data, prisma);
    // A changed duration re-dated open activities on these projects. The save
    // has committed, so their cached screens are refreshed now rather than
    // showing the old dates until the cache expires.
    if (affectedProjectIds.length > 0) {
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      for (const projectId of affectedProjectIds) {
        revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
      }
    }
    return successResponse(template);
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Build sequence save failed", error);
    return errorResponse("Could not save the build sequence. Try again.", {
      status: 500,
    });
  }
}
