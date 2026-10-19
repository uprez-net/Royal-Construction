"use server";

import prisma from "@/lib/prisma";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { isDomainError } from "@/lib/domain/errors";
import { userPrincipal } from "@/lib/domain/principal";
import { draftTradieRequestWorkDetails } from "@/lib/domain/tradies/requests";
import type { WorkDetailsDraft } from "@/lib/domain/ports/tradie-request-ai";
import { draftTradieRequestWorkDetailsWithAi } from "@/lib/projects/tradie-request-ai";

// Its own module rather than a export beside the request send: `@/lib/model`
// throws on import without AI_GATEWAY_API_KEY, which would take every schedule
// action down with it in an environment that has no gateway key.

const requestAi = { draftWorkDetails: draftTradieRequestWorkDetailsWithAi };

/**
 * Draft the work-detail lines for a tradie request's activities. Returns the
 * lines for the office to edit; writes nothing and sends nothing.
 */
export async function draftTradieRequestWorkDetailsAction(input: {
  readonly projectId: string;
  readonly trade: string;
  readonly milestoneIds: readonly string[];
}): Promise<WorkDetailsDraft> {
  const guard = await requireInternalUser();
  if (!guard.ok) return { ok: false, message: guard.error };
  try {
    return await draftTradieRequestWorkDetails(
      userPrincipal(guard.user),
      input,
      prisma,
      requestAi,
    );
  } catch (error) {
    if (isDomainError(error)) return { ok: false, message: error.message };
    console.error("Error drafting tradie request work details:", error);
    return {
      ok: false,
      message:
        "The draft could not be generated. Write the work details by hand, or try again.",
    };
  }
}
