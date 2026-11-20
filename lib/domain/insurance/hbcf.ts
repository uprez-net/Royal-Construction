import { ProjectStatus } from "@prisma/client";
import { format } from "date-fns";

import type { DomainDb } from "../db";
import { authorizeLead } from "../access/leads";
import { canSeeProjectFinancials } from "../access/projects";
import { DomainAuthorizationError } from "../errors";
import { getAdminOfferContent } from "../admin/offer-content";
import { systemPrincipal, type DomainPrincipal } from "../principal";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import {
  hbcfAssessment,
  hbcfProjectBreach,
  hbcfNeedRange as resolveHbcfNeedRange,
  type HbcfProjectBreach,
  type HbcfProjectClaim,
  type HbcfTimelinePayload,
} from "@/lib/insurance/hbcf";
import { hbcfClaimTotal, readHbcfClaimDocuments } from "./hbcf-claims";

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
  const payload = requirements as ProjectRequirementsPayload | null;
  // The confirmed HBCF claim documents are the real figure (issue #423); the
  // contract sum and budget are what the pool used before any were recorded.
  const confirmed = hbcfClaimTotal(
    readHbcfClaimDocuments(payload?.legalAdministration),
  ).total;
  const commercials = payload?.commercialsAndClaims;
  const candidates = [
    confirmed,
    commercials?.totalContractSum,
    Number(totalBudget),
  ];
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

/**
 * The HBCF pool is the whole company's insurance book: every active project's
 * claim amount (or, before one is confirmed, its contract sum or budget) and
 * the client name it is for. That is project money, so it is read by whoever
 * may see project money and nobody else — not a site manager.
 */
function assertCanReadHbcfPool(principal: DomainPrincipal): void {
  if (!canSeeProjectFinancials(principal)) {
    throw new DomainAuthorizationError(
      "The HBCF claim pool is only available to the office.",
    );
  }
}

/** Build the lead HBCF timeline from one explicit database boundary. */
export async function getHbcfTimelineForLead(
  principal: DomainPrincipal,
  leadId: number,
  db: DomainDb,
): Promise<HbcfTimelinePayload | null> {
  assertCanReadHbcfPool(principal);
  // A missing lead is a DomainNotFoundError here, which the route answers 404.
  await authorizeLead(principal, leadId, db);
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
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<HbcfProjectBreach | null> {
  assertCanReadHbcfPool(principal);
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
