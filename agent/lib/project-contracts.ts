import { z } from "zod";
import { ComplianceDocumentType } from "@prisma/client";
import { jsonValueSchema } from "@/agent/lib/result-contracts";

export const projectIdSchema = z.string().uuid();
export const milestoneIdSchema = z.string().uuid();
export const variationIdSchema = z.string().uuid();

export const searchProjectsInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(25).default(10),
});

export const getProjectInputSchema = z.object({ projectId: projectIdSchema });

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

export const getProjectRequirementsInputSchema = z.object({ projectId: projectIdSchema });

export const updateProjectRequirementsInputSchema = z.object({
  projectId: projectIdSchema,
  expectedUpdatedAt: z.iso.datetime(),
  patch: z
    .record(z.string().min(1).max(80), jsonValueSchema)
    .refine((value) => Object.keys(value).every((key) => (requirementSectionKeys as readonly string[]).includes(key)), {
      message: "Patch contains an unsupported project requirements section.",
    })
    .refine((value) => JSON.stringify(value).length <= 150_000, {
      message: "Project requirements patch is too large.",
    }),
});

export const getComplianceInputSchema = z.object({ projectId: projectIdSchema });

export const startComplianceInputSchema = z.object({
  projectId: projectIdSchema,
  subjectAddress: z.string().trim().min(1).max(500),
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

const compliancePartyValues = ["SURVEYOR", "ARCHITECT", "COUNCIL", "BASIX_CONSULTANT", "BUSHFIRE_CONSULTANT", "DEVELOPER", "STRUCTURAL_ENGINEER", "WATER_AUTHORITY", "TRAFFIC_CONSULTANT"] as const;
export const prepareComplianceOutreachInputSchema = z.object({
  projectId: projectIdSchema,
  party: z.enum(compliancePartyValues).optional(),
  alertId: z.string().uuid().optional(),
}).refine((value) => Boolean(value.party) !== Boolean(value.alertId), { message: "Provide exactly one of party or alertId." });

export const sendComplianceOutreachInputSchema = z.object({
  projectId: projectIdSchema,
  party: z.enum(compliancePartyValues),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.email().trim().toLowerCase(),
  contactPhone: z.string().trim().max(80).optional(),
  body: z.string().trim().min(1).max(100_000),
  deliverables: z.array(z.object({ documentType: z.enum(ComplianceDocumentType), checklistDocumentId: z.string().uuid().optional() })).max(20).default([]),
  extraAttachmentIds: z.array(z.string().uuid()).max(20).default([]),
});

export const sendComplianceFollowUpInputSchema = z.object({
  projectId: projectIdSchema,
  alertId: z.string().uuid(),
  body: z.string().trim().min(1).max(100_000),
});

const projectStages = ["Deposit", "Slab", "Frame", "Lockup", "Interior_Fit_Out", "Final"] as const;
export const createMilestoneInputSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  targetDate: z.iso.date(),
  budget: z.number().finite().positive(),
  parentId: milestoneIdSchema.optional(),
  projectStage: z.enum(projectStages),
});

export const updateMilestoneInputSchema = z.object({
  milestoneId: milestoneIdSchema,
  status: z.enum(["PENDING", "ACTIVE", "DONE", "NOT_REQUIRED"]),
  targetDate: z.iso.date().optional(),
  startDate: z.iso.date().optional(),
  actualDate: z.iso.date().optional(),
  spend: z.number().finite().nonnegative().optional(),
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
