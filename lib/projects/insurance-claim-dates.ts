import { MilestoneStatus, ProjectStage } from "@prisma/client";
import { addMonths, format, isValid, parseISO } from "date-fns";
import type { ProjectRequirementsPayload } from "@/types/project-flow";

/**
 * Insurance coverage for a build is tied to the physical start of construction,
 * which in the stage model is the Slab stage. These helpers own the two
 * questions that follow from that: which milestone start should prompt for the
 * coverage window, and how that window is read from / written onto the
 * project's `requirements` payload.
 */

/** A partially populated `requirements` payload, as the project actually stores it. */
export type ProjectRequirementsDraft = Partial<ProjectRequirementsPayload>;

export interface InsuranceClaimDates {
  /** `yyyy-MM-dd` */
  insuranceClaimStartDate: string;
  /** `yyyy-MM-dd` */
  insuranceClaimEndDate: string;
}

/** The milestone fields needed to pick the Slab-stage trigger. */
export interface MilestoneStageInfo {
  id: string;
  order: number;
  parentId: string | null;
  status: MilestoneStatus;
  projectStage: ProjectStage;
}

/**
 * How long HBCF cover runs when nobody has said otherwise. The certificate
 * usually prints only the date cover starts, so this is the end date we fill in
 * for the office to confirm, not a reading of the document.
 */
export const DEFAULT_INSURANCE_COVER_MONTHS = 12;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `yyyy-MM-dd` string that names a real calendar day, or null. Rejects
 * "2026-02-30" as well as anything not in that shape, so a model's guess at a
 * date cannot reach the project as a malformed value.
 */
export function normalizeIsoDate(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!ISO_DATE.test(trimmed)) return null;
  const parsed = parseISO(trimmed);
  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== trimmed) return null;
  return trimmed;
}

/** The default end of cover: the start date plus {@link DEFAULT_INSURANCE_COVER_MONTHS}. */
export function defaultInsuranceClaimEndDate(startDate: string) {
  const start = normalizeIsoDate(startDate);
  if (!start) return null;
  return format(
    addMonths(parseISO(start), DEFAULT_INSURANCE_COVER_MONTHS),
    "yyyy-MM-dd",
  );
}

export function readInsuranceClaimDates(
  requirements: ProjectRequirementsDraft | null | undefined,
) {
  const legal = requirements?.legalAdministration;

  return {
    insuranceClaimStartDate: legal?.insuranceClaimStartDate ?? null,
    insuranceClaimEndDate: legal?.insuranceClaimEndDate ?? null,
  };
}

/**
 * True once both dates are on the project, which is what stops the kickoff
 * prompt reappearing on later start attempts and page loads.
 */
export function hasInsuranceClaimDates(
  requirements: ProjectRequirementsDraft | null | undefined,
) {
  const { insuranceClaimStartDate, insuranceClaimEndDate } =
    readInsuranceClaimDates(requirements);

  return Boolean(insuranceClaimStartDate && insuranceClaimEndDate);
}

/**
 * The milestone whose start opens the prompt: the earliest Slab-stage milestone
 * that can actually be started. Parents are excluded because the milestone card
 * only offers "Start Activity" on leaves, and `NOT_REQUIRED` milestones are
 * excluded because they are skipped outright — in either case the prompt would
 * never fire if it were pinned to them.
 */
export function findInsuranceTriggerMilestoneId(
  milestones: readonly MilestoneStageInfo[],
) {
  const parentIds = new Set(
    milestones.map((milestone) => milestone.parentId).filter(Boolean),
  );

  const candidates = milestones.filter(
    (milestone) =>
      milestone.projectStage === ProjectStage.Slab &&
      milestone.status !== MilestoneStatus.NOT_REQUIRED &&
      !parentIds.has(milestone.id),
  );

  if (candidates.length === 0) return null;

  return candidates.reduce((earliest, milestone) =>
    milestone.order < earliest.order ? milestone : earliest,
  ).id;
}

/**
 * Every section the project PATCH route requires, so the first save can still
 * land on a project that has no extracted `requirements` yet instead of being
 * rejected as an incomplete payload.
 */
const EMPTY_REQUIREMENTS: ProjectRequirementsDraft = {
  version: 1,
  projectName: "",
  projectType: "",
  summary: "",
  legalAdministration: {
    siteAddress: null,
    ownerContacts: { names: [], emails: [], phones: [] },
    commencementTrigger: null,
    signedDate: null,
    pcaInspector: null,
    hbcfInsuranceNumber: null,
    hbcfInsuranceDocument: null,
  },
  commercialsAndClaims: {
    totalContractSum: null,
    gstIncluded: null,
    gstAmount: null,
    depositValue: null,
    claimStageSlabPercentage: null,
    claimStageSlabDollarValue: null,
    variationAdminFee: null,
    latePenaltyRate: null,
    paymentStages: [],
  },
  subStructureAndGround: {
    concreteSlabClass: null,
    concreteStrengthMpa: null,
    vapourBarrier: null,
    termiteSystem: null,
    sewerConnection: null,
  },
  inclusionsAndExclusions: { inclusions: [], exclusions: [] },
  utilityInfrastructure: {
    electricalPhase: null,
    communicationConduit: null,
    gasConnection: null,
    fridgeWaterPoint: null,
    smartLockBrand: null,
  },
  wetAreaCompliance: {
    waterproofingStandard: null,
    showerScreenType: null,
    tiledNicheCount: null,
    showerCount: null,
    floorToCeilingTiles: null,
    floorWasteType: null,
  },
  safetyAndSiteLogistics: {
    roofGuardrails: null,
    sedimentControl: null,
    scaffoldingSafety: null,
    tradeWaste: null,
    finalCleanStatus: null,
  },
  conflicts: [],
  automationTriggers: {
    orderReminders: true,
    rainDelayCalculations: true,
    noticeCountdowns: true,
  },
};

/**
 * Merge the coverage window into the project's existing requirements, leaving
 * every other section untouched so the PATCH stays a partial update of one
 * field pair.
 */
export function withInsuranceClaimDates(
  requirements: ProjectRequirementsDraft | null | undefined,
  dates: InsuranceClaimDates,
): ProjectRequirementsDraft {
  const current = requirements ?? {};

  return {
    ...EMPTY_REQUIREMENTS,
    ...current,
    legalAdministration: {
      ...EMPTY_REQUIREMENTS.legalAdministration!,
      ...current.legalAdministration,
      insuranceClaimStartDate: dates.insuranceClaimStartDate,
      insuranceClaimEndDate: dates.insuranceClaimEndDate,
    },
  };
}
