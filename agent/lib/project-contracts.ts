import { z } from "zod";
import { ComplianceDocumentType } from "@prisma/client";
import { jsonValueSchema } from "@/agent/lib/result-contracts";
import { hasAtMostTwoDecimalPlaces } from "@/utils/validators/common";
import { MAX_BULK_MILESTONE_UPDATES } from "@/lib/domain/projects/milestones";

export const projectIdSchema = z.string().uuid();
export const milestoneIdSchema = z.string().uuid();
export const variationIdSchema = z.string().uuid();

export const searchProjectsInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(25).default(10),
});

export const getProjectInputSchema = z.object({ projectId: projectIdSchema });

export const listSiteManagersInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(25).default(10),
});

export const assignSiteManagerInputSchema = z.object({
  projectId: projectIdSchema,
  /** An id from list_site_managers, never one inferred from a name. */
  siteManagerId: z.string().uuid(),
});

const requirementSectionKeys = [
  "projectName",
  "projectType",
  "summary",
  "legalAdministration",
  "commercialsAndClaims",
  "subStructureAndGround",
  "inclusionsAndExclusions",
  "utilityInfrastructure",
  "wetAreaCompliance",
  "safetyAndSiteLogistics",
  "conflicts",
  "automationTriggers",
  "sourceDocuments",
  "validations",
] as const;

export const getProjectRequirementsInputSchema = z.object({
  projectId: projectIdSchema,
});

export const getProjectFinancialsInputSchema = z.object({
  projectId: projectIdSchema,
});

export const updateProjectRequirementsInputSchema = z.object({
  projectId: projectIdSchema,
  expectedUpdatedAt: z.iso.datetime(),
  patch: z
    .record(z.string().min(1).max(80), jsonValueSchema)
    .refine(
      (value) =>
        Object.keys(value).every((key) =>
          (requirementSectionKeys as readonly string[]).includes(key),
        ),
      {
        message: "Patch contains an unsupported project requirements section.",
      },
    )
    .refine((value) => JSON.stringify(value).length <= 150_000, {
      message: "Project requirements patch is too large.",
    }),
});

export const getComplianceInputSchema = z.object({
  projectId: projectIdSchema,
});

export const startComplianceInputSchema = z.object({
  projectId: projectIdSchema,
  /** Defaults to the project's name and location; see defaultComplianceSubjectAddress. */
  subjectAddress: z.string().trim().min(1).max(500).optional(),
  certifierName: z.string().trim().max(200).optional(),
  certifierEmail: z.email().trim().toLowerCase(),
  certifierPhone: z.string().trim().max(80).optional(),
});

export const resolveComplianceDocumentInputSchema = z.object({
  projectId: projectIdSchema,
  documentId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().trim().max(2_000).optional(),
});

export const setComplianceDocumentRequiredInputSchema = z.object({
  projectId: projectIdSchema,
  documentId: z.string().uuid(),
  notRequired: z.boolean(),
});

const compliancePartyValues = [
  "SURVEYOR",
  "ARCHITECT",
  "COUNCIL",
  "BASIX_CONSULTANT",
  "BUSHFIRE_CONSULTANT",
  "DEVELOPER",
  "STRUCTURAL_ENGINEER",
  "WATER_AUTHORITY",
  "TRAFFIC_CONSULTANT",
] as const;
export const prepareComplianceOutreachInputSchema = z
  .object({
    projectId: projectIdSchema,
    party: z.enum(compliancePartyValues).optional(),
    alertId: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.party) !== Boolean(value.alertId), {
    message: "Provide exactly one of party or alertId.",
  });

export const sendComplianceOutreachInputSchema = z.object({
  projectId: projectIdSchema,
  party: z.enum(compliancePartyValues),
  /**
   * The directory tradie being engaged, from prepare_compliance_outreach's
   * directoryContacts. Required for every party picked from the directory.
   */
  tradieId: z.string().uuid().optional(),
  /** The estate, for the developer party only. */
  developerKey: z.string().trim().min(1).max(100).optional(),
  contactName: z.string().trim().max(200).optional(),
  /** One of the chosen tradie's own addresses; defaults to their primary one. */
  contactEmail: z.email().trim().toLowerCase().optional(),
  contactPhone: z.string().trim().max(80).optional(),
  body: z.string().trim().min(1).max(100_000),
  deliverables: z
    .array(
      z.object({
        documentType: z.enum(ComplianceDocumentType),
        checklistDocumentId: z.string().uuid().optional(),
      }),
    )
    .max(20)
    .default([]),
  extraAttachmentIds: z.array(z.string().uuid()).max(20).default([]),
  /**
   * File ids from prepare_compliance_outreach's `attachments` to leave off.
   * The party's standard pack is attached automatically; this is how a person
   * who wants it left off, or one file of it, says so.
   */
  // Sized to leave off a whole pack: a pack is every file on the party's
  // standard documents, and a document can hold any number of uploads, so a
  // cap of 20 could make "send it without attachments" impossible.
  omitAttachmentIds: z.array(z.string().uuid()).max(500).default([]),
});

export const sendComplianceFollowUpInputSchema = z.object({
  projectId: projectIdSchema,
  alertId: z.string().uuid(),
  body: z.string().trim().min(1).max(100_000),
});

const projectStages = [
  "Deposit",
  "Slab",
  "Frame",
  "Lockup",
  "Interior_Fit_Out",
  "Final",
] as const;
export const createMilestoneInputSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  targetDate: z.iso.date(),
  budget: z.number().finite().positive().refine(hasAtMostTwoDecimalPlaces, {
    message: "Budget must have at most two decimal places.",
  }),
  parentId: milestoneIdSchema.optional(),
  projectStage: z.enum(projectStages),
});

/**
 * Reprice one activity. Both figures are dollars ex GST, before variations —
 * the `price` get_project_financials returns for the activity — and the
 * expected one is the figure just read, so a price that moved in between is
 * refused instead of overwritten.
 */
export const setActivityPriceInputSchema = z.object({
  milestoneId: milestoneIdSchema,
  price: z.number().finite().nonnegative().refine(hasAtMostTwoDecimalPlaces, {
    message: "Price must have at most two decimal places.",
  }),
  expectedPrice: z
    .number()
    .finite()
    .nonnegative()
    .refine(hasAtMostTwoDecimalPlaces, {
      message: "Expected price must have at most two decimal places.",
    }),
});

export const updateMilestoneInputSchema = z.object({
  milestoneId: milestoneIdSchema,
  status: z.enum(["PENDING", "ACTIVE", "DONE", "NOT_REQUIRED"]),
  targetDate: z.iso.date().optional(),
  startDate: z.iso.date().optional(),
  actualDate: z.iso.date().optional(),
  spend: z
    .number()
    .finite()
    .nonnegative()
    .refine(hasAtMostTwoDecimalPlaces, {
      message: "Spend must have at most two decimal places.",
    })
    .optional(),
});

/**
 * Several milestones on one project, in one call and one approval (#616).
 * Each entry is exactly an `update_milestone` input.
 */
export const updateMilestonesInputSchema = z.object({
  projectId: projectIdSchema,
  updates: z
    .array(updateMilestoneInputSchema)
    .min(2, "Use update_milestone for a single milestone.")
    .max(MAX_BULK_MILESTONE_UPDATES),
});

export const createVariationInputSchema = z.object({
  projectId: projectIdSchema,
  description: z.string().trim().min(1).max(2_000),
  cost: z.number().finite(),
  requestedDate: z.iso.date().optional(),
  delayDays: z.number().int().min(0).max(365).default(0),
});

export const updateVariationStatusInputSchema = z.object({
  variationId: variationIdSchema,
  status: z.enum(["APPROVED", "REJECTED"]),
});
