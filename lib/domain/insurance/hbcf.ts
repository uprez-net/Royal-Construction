import { ProjectStatus } from "@prisma/client";
import { format } from "date-fns";

import type { DomainDb } from "../db";
import { getAdminOfferContent } from "../admin/offer-content";
import { systemPrincipal } from "../principal";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import {
  hbcfAssessment,
  hbcfProjectBreach,
  hbcfNeedRange as resolveHbcfNeedRange,
  type HbcfProjectBreach,
  type HbcfProjectClaim,
  type HbcfTimelinePayload,
} from "@/lib/insurance/hbcf";

function readClaimWindow(requirements: unknown) {
  const legal = (requirements as ProjectRequirementsPayload | null)
    ?.legalAdministration;
  const start = legal?.insuranceClaimStartDate?.trim();
  const end = legal?.insuranceClaimEndDate?.trim();
  if (!start || !end) return null;
  return { end, start };
}

function readClaimAmount(
  requirements: unknown,
  totalBudget: unknown,
): number | null {
  const commercials = (requirements as ProjectRequirementsPayload | null)
    ?.commercialsAndClaims;
  const candidates = [commercials?.totalContractSum, Number(totalBudget)];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

/** Read the active HBCF pool in stable claim-window order. */
export async function getActiveHbcfClaims(
  db: DomainDb,
): Promise<HbcfProjectClaim[]> {
  const projects = await db.project.findMany({
    select: {
      id: true,
      name: true,
      totalBudget: true,
      requirements: true,
      Lead: { select: { name: true } },
    },
    where: { status: { not: ProjectStatus.COMPLETED } },
  });

  return projects
    .flatMap((project) => {
      const window = readClaimWindow(project.requirements);
      if (!window) return [];
      const claimAmount = readClaimAmount(
        project.requirements,
        project.totalBudget,
      );
      if (claimAmount === null) return [];
      return [
        {
          claimAmount,
          insuranceClaimEndDate: window.end,
          insuranceClaimStartDate: window.start,
          leadName: project.Lead?.name ?? null,
          projectId: project.id,
          projectName: project.name,
        } satisfies HbcfProjectClaim,
      ];
    })
    .sort((a, b) => {
      const byStart = a.insuranceClaimStartDate.localeCompare(
        b.insuranceClaimStartDate,
      );
      return byStart !== 0 ? byStart : a.projectId.localeCompare(b.projectId);
    });
}

/** Build the lead HBCF timeline from one explicit database boundary. */
export async function getHbcfTimelineForLead(
  leadId: number,
  db: DomainDb,
): Promise<HbcfTimelinePayload | null> {
  const [lead, claims, adminContent] = await Promise.all([
    db.lead.findUnique({
      select: {
        id: true,
        budget: true,
        estimatedValue: true,
        estimatedStartDate: true,
      },
      where: { id: leadId },
    }),
    getActiveHbcfClaims(db),
    getAdminOfferContent(systemPrincipal("HBCF timeline read"), db),
  ]);
  if (!lead) return null;

  const today = new Date();
  return {
    assessment: hbcfAssessment({
      claims,
      needRange: resolveHbcfNeedRange({
        estimatedValue:
          lead.estimatedValue === null ? null : Number(lead.estimatedValue),
        budget: lead.budget,
      }),
      today,
      estimatedStartDate: lead.estimatedStartDate,
      totalSumAssured: adminContent.hbcfClaim.claimAmount,
    }),
    claims,
    generatedAt: format(today, "yyyy-MM-dd"),
  };
}

/** Report whether a project breaches the active HBCF pool. */
export async function getHbcfBreachForProject(
  projectId: string,
  db: DomainDb,
): Promise<HbcfProjectBreach | null> {
  const [claims, adminContent] = await Promise.all([
    getActiveHbcfClaims(db),
    getAdminOfferContent(systemPrincipal("HBCF breach read"), db),
  ]);
  return hbcfProjectBreach({
    claims,
    projectId,
    totalSumAssured: adminContent.hbcfClaim.claimAmount,
  });
}

export type { HbcfProjectBreach, HbcfProjectClaim, HbcfTimelinePayload };
