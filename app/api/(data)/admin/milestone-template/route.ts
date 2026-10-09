import { ProjectStage } from "@prisma/client";
import { z } from "zod";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  readMilestoneTemplate,
  saveMilestoneTemplate,
} from "@/lib/domain/projects/templates";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  validationErrorResponse,
} from "@/utils/validators/response";

const schema = z.object({
  revision: z.string().length(64),
  activities: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().trim().min(1).max(200),
        order: z.number().int().positive(),
        parentId: z.string().min(1).max(100).nullable(),
        projectStage: z.enum(ProjectStage),
        relatedCostLines: z
          .array(z.string().trim().max(200))
          .max(100)
          .transform((lines) => lines.filter(Boolean)),
        estimatedDays: z.number().int().min(1).max(365),
        requiredTradeTypeId: z.string().min(1).max(100).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

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
    const input = schema.safeParse(body);
    if (!input.success) return validationErrorResponse(input.error);
    return successResponse(
      await saveMilestoneTemplate(principal, input.data, prisma),
    );
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Build sequence save failed", error);
    return errorResponse("Could not save the build sequence. Try again.", {
      status: 500,
    });
  }
}
