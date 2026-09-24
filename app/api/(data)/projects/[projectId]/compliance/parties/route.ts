import { ComplianceOutreachMode } from "@prisma/client";
import { NextRequest } from "next/server";

import {
  complianceAccessResponse,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import {
  recordPartySelfSupplied,
  startPartyOutreach,
} from "@/lib/data/compliance-outreach";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  errorResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import {
  partySelfSuppliedSchema,
  startPartyOutreachSchema,
} from "@/utils/validators/compliance";
import { z } from "zod";

// The architect's outreach carries the surveyor's whole set — a deposited plan,
// a title search and a survey — back out of blob storage and up through Graph.
// Well past the default budget, same as the certifier's own outreach route.
export const maxDuration = 300;

/**
 * Engages a party, or records that the client already had their documents.
 *
 * One route rather than two because it is one decision made at one moment, from
 * the same locked panel: either we are writing to a surveyor or the client
 * brought their own survey. Splitting it left two endpoints that must never
 * both succeed on the same file, with nothing but ordering to stop them.
 *
 * The discriminator is `mode`, and the two branches take genuinely different
 * bodies — the self-supplied one has no contact to carry — so each is parsed
 * against its own schema rather than one union with half its fields optional.
 */
const modeSchema = z.object({
  mode: z.enum(ComplianceOutreachMode).default(ComplianceOutreachMode.OUTREACH),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const { projectId } = routeParams.data;

  // Read once: the body is consumed by the first parse, so the mode and the
  // payload proper are taken off the same parsed object rather than by reading
  // the request twice.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("Invalid request body.", {
      status: 400,
      code: "INVALID_BODY",
    });
  }

  const mode = modeSchema.safeParse(raw);
  if (!mode.success) {
    return errorResponse("Invalid request body.", {
      status: 400,
      code: "INVALID_BODY",
    });
  }

  try {
    const { user } = await requireComplianceAccess(projectId);

    if (mode.data.mode === ComplianceOutreachMode.SELF_SUPPLIED) {
      const body = partySelfSuppliedSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          body.error.issues[0]?.message ?? "Invalid request body.",
          { status: 400, code: "INVALID_BODY" },
        );
      }
      const engagement = await recordPartySelfSupplied(
        userPrincipal(user),
        projectId,
        body.data.party,
        user.name,
      );
      return successResponse(engagement, { status: 201 });
    }

    const body = startPartyOutreachSchema.safeParse(raw);
    if (!body.success) {
      return errorResponse(
        body.error.issues[0]?.message ?? "Invalid request body.",
        { status: 400, code: "INVALID_BODY" },
      );
    }

    const engagement = await startPartyOutreach(
      userPrincipal(user),
      projectId,
      body.data,
      request.headers.get("idempotency-key") ?? undefined,
    );
    return successResponse(engagement, { status: 201 });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error("Failed to engage a compliance party", error);
    // The data layer refuses on an unmet prerequisite and lets Graph's own size
    // assertion through, so both reach the user as the message that actually
    // explains them rather than a generic 500.
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to engage this party on the compliance file.",
      { status: 400, code: "PARTY_OUTREACH_FAILED" },
    );
  }
}
