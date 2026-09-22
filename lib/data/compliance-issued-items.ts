import "server-only";

import { revalidateTag } from "next/cache";

import type { AssessorKind } from "@/lib/agent/assessorCorrespondenceAgent";
import { notifyCompliance } from "@/lib/compliance/notify";
import {
  applyAssessorCorrespondence as applyAssessorCorrespondenceDomain,
  type IssuedItemOutcome,
} from "@/lib/domain/compliance/issued-items";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { logAction } from "./actionLog";

/**
 * The request-shaped half of recording what an assessing body sent.
 *
 * The rule — add without reconciling, refuse to write the same request twice,
 * place an objection or report that it could not be placed — is in
 * lib/domain/compliance/issued-items.ts, because a durable workflow step and a
 * screen both reach it. What stays here is what only a Next request can do:
 * the cache tags, the activity entry and the in-app notification.
 */

export type { IssuedItemOutcome };

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`compliance-${projectId}`, CACHE_PROFILES.SHORT);
}

export async function applyAssessorCorrespondence(params: {
  projectId: string;
  engagementId: string;
  assessor: AssessorKind;
  requested: { label: string; description: string }[];
  rejected: { documentName: string; reason: string }[];
}): Promise<IssuedItemOutcome> {
  const outcome = await applyAssessorCorrespondenceDomain(
    systemPrincipal("compliance-assessor-correspondence"),
    params,
    prisma,
  );

  // An unmatched rejection on its own changed nothing on the file, so there is
  // nothing to revalidate or announce — the caller logs it against the thread.
  if (outcome.created === 0 && outcome.rejected === 0) {
    return outcome;
  }

  revalidateEngagement(params.projectId);

  await logAction(
    createActivityLogEntry("complianceIssuedItemsRecorded", {
      projectId: params.projectId,
      engagementId: params.engagementId,
      assessor: params.assessor,
      requestedCount: outcome.created,
      rejectedCount: outcome.rejected,
      unmatched: outcome.unmatched,
    }),
  );

  await notifyCompliance("complianceDaItemsRequested", params.projectId, {
    requestedCount: outcome.created,
    rejectedCount: outcome.rejected,
  });

  return outcome;
}
