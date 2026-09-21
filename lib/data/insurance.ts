import "server-only";

import { ProjectStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import {
  hbcfAssessment,
  hbcfNeedRange,
  hbcfProjectBreach,
  type HbcfProjectBreach,
  type HbcfProjectClaim,
  type HbcfTimelinePayload,
} from "@/lib/insurance/hbcf";
import { format } from "date-fns";
import { getAdminOfferContent } from "./admin-offer-content";

/**
 * HBCF claim capacity, read across every project that is still holding cover.
 *
 * The card on the lead detail page needs the whole book to work out how much of
 * the pool is committed, so this deliberately returns only the handful of fields
 * it renders — never the project rows themselves.
 */

/** A cover period only counts once both ends of it are recorded. */
function readClaimWindow(requirements: unknown) {
  const legal = (requirements as ProjectRequirementsPayload | null)
    ?.legalAdministration;

  const start = legal?.insuranceClaimStartDate?.trim();
  const end = legal?.insuranceClaimEndDate?.trim();

  if (!start || !end) return null;

  return { start, end };
}

/**
 * Cover is written against the contract price, so that is the claim amount.
 * The extracted contract figures are preferred over `totalBudget`, which is the
 * builder's internal number and drifts from the insured value.
 */
function readClaimAmount(
  requirements: unknown,
  totalBudget: unknown,
): number | null {
  const commercials = (requirements as ProjectRequirementsPayload | null)
    ?.commercialsAndClaims;

  const candidates = [
    commercials?.contractPrice,
    commercials?.totalContractSum,
    Number(totalBudget),
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }

  return null;
}

/**
 * Every project still holding HBCF cover, ordered by when its window opened so
 * colour assignment downstream is stable across reloads.
 */
export async function getActiveHbcfClaims(): Promise<HbcfProjectClaim[]> {
  const projects = await prisma.project.findMany({
    where: { status: { not: ProjectStatus.COMPLETED } },
    select: {
      id: true,
      name: true,
      totalBudget: true,
      requirements: true,
      Lead: { select: { name: true } },
    },
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
          projectId: project.id,
          projectName: project.name,
          leadName: project.Lead?.name ?? null,
          insuranceClaimStartDate: window.start,
          insuranceClaimEndDate: window.end,
          claimAmount,
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
 * The full payload behind the HBCF card: the active claims plus the build-start
 * assessment scoped to the lead being viewed. Computed here so the client makes
 * one request and never has to fetch projects itself.
 */
export async function getHbcfTimelineForLead(
  leadId: number,
): Promise<HbcfTimelinePayload | null> {
  const [lead, claims, adminContent] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        budget: true,
        estimatedValue: true,
        estimatedStartDate: true,
      },
    }),
    getActiveHbcfClaims(),
    getAdminOfferContent(),
  ]);

  if (!lead) return null;

  const today = new Date();

  return {
    claims,
    assessment: hbcfAssessment({
      claims,
      needRange: hbcfNeedRange({
        estimatedValue:
          lead.estimatedValue === null ? null : Number(lead.estimatedValue),
        budget: lead.budget,
      }),
      today,
      estimatedStartDate: lead.estimatedStartDate,
      totalSumAssured: adminContent.hbcfClaim.claimAmount,
    }),
    generatedAt: format(today, "yyyy-MM-dd"),
  };
}

/**
 * Whether this project's cover window overlaps others badly enough to push the
 * HBCF pool past its limit — the input to the warning badge on the project
 * header.
 *
 * Reads the same book as `getHbcfTimelineForLead`, but asks a different
 * question of it: not "is there room for a new build?" but "is the room this
 * build already occupies room we actually have?". Returns `null` when there is
 * nothing to warn about, which is the expected answer on most projects.
 *
 * Note that `getActiveHbcfClaims` excludes completed projects, so a finished
 * project reports no breach — its cover is no longer held against the pool.
 */
export async function getHbcfBreachForProject(
  projectId: string,
): Promise<HbcfProjectBreach | null> {
  const [claims, adminContent] = await Promise.all([
    getActiveHbcfClaims(),
    getAdminOfferContent(),
  ]);

  return hbcfProjectBreach({
    claims,
    projectId,
    totalSumAssured: adminContent.hbcfClaim.claimAmount,
  });
}
