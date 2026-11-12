import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checklistPorts } from "@/lib/data/checklists";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { userPrincipal } from "@/lib/domain/principal";
import { exportChecklistDocument } from "@/lib/domain/projects/checklist-export";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

// Download one project checklist as a PDF (issue #420). POST rather than GET
// because the request carries the reviewer's name and drawn signature, which
// belong in a body rather than a URL. The domain decides whether it prints as
// final or as a draft; this renders and streams it.

const exportSchema = z.object({
  reviewerName: z.string().max(120),
  signatureDataUrl: z.string().max(300_000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; checklistId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return unauthorizedResponse();
  const user = await getUserByClerkIdCached(userId);
  if (!user) return unauthorizedResponse();
  const body = await parseBodyWithResponse(request, exportSchema);
  if (!body.success) return body.response;
  const { checklistId, projectId } = await params;

  try {
    const exported = await exportChecklistDocument(
      userPrincipal(user),
      { checklistId, projectId, ...body.data },
      prisma,
      checklistPorts.renderDocument,
    );
    return new Response(Buffer.from(exported.pdf), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Content-Type": "application/pdf",
        "X-Checklist-Export-Final": exported.final ? "true" : "false",
      },
      status: 200,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to export checklist", error);
    return errorResponse(
      "Unable to generate the checklist document. Please try again.",
      { status: 500 },
    );
  }
}
