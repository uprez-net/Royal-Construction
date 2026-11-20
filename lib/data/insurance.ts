import "server-only";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import {
  getActiveHbcfClaims as getActiveHbcfClaimsDomain,
  getHbcfBreachForProject as getHbcfBreachForProjectDomain,
  getHbcfTimelineForLead as getHbcfTimelineForLeadDomain,
} from "@/lib/domain/insurance/hbcf";
export type {
  HbcfProjectBreach,
  HbcfProjectClaim,
  HbcfTimelinePayload,
} from "@/lib/domain/insurance/hbcf";

/** Next adapter: cache/auth concerns stay here; HBCF reads stay in domain. */
export function getActiveHbcfClaims() {
  return getActiveHbcfClaimsDomain(prisma);
}

export async function getHbcfTimelineForLead(leadId: number) {
  return getHbcfTimelineForLeadDomain(await currentPrincipal(), leadId, prisma);
}

export async function getHbcfBreachForProject(projectId: string) {
  return getHbcfBreachForProjectDomain(
    await currentPrincipal(),
    projectId,
    prisma,
  );
}
