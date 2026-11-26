import { Prisma, ProjectStatus } from "@prisma/client";
import { z } from "zod";
import type { ProjectListSortBy } from "@/lib/data/projects";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import type { ProjectExtractionData } from "@/types/project-extraction";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import {
  DRAFTING_FILTER,
  OPEN_PROJECTS_FILTER,
  OVERDUE_FILTER,
} from "@/types/project";
import {
  emailSchema,
  nonNegativeSchema,
  normalizedStringSchema,
  // optionalIsoDateSchema,
  paginationSchema,
  sortOrderSchema,
  isoDateStringSchema,
} from "./common";
/**
 * Project-related validators
 * Covers project CRUD, filtering, and queries
 */

// ============================================================================
// Project Creation & Updates
// ============================================================================

const customerModeSchema = z.enum(["existing", "new"]);

// ---------------------------------------------------------------------------
// Offer -> project handoff
// ---------------------------------------------------------------------------

// yyyy-MM-dd or a full ISO datetime; the writer parses either with new Date().
const handoffDateSchema = (message: string) =>
  z.union([z.iso.date(message), z.iso.datetime(message)]);

// The kind is fixed per position: the two slots are the Tender and the
// Contract specifically, and accepting either (or an HBCF certificate) in
// both would let a contract be stored as the tender.
const sourceDocumentSchema = <K extends "tender" | "contract">(kind: K) =>
  z.object({
    fileId: z.string().trim().min(1, "The document is missing its file id"),
    fileName: z.string().trim().min(1, "The document is missing its file name"),
    url: z.string().trim().url("The document URL is not a valid URL"),
    kind: z.literal(kind),
  });

/**
 * The browser-supplied payload behind `createProjectWithLeadAction`.
 *
 * `createProjectWithLead` writes `parties` straight onto `Project.parties`,
 * trusts `siteManagerId`, and runs `new Date(...)` over the two date strings,
 * so an unvalidated payload either persists a malformed project or fails the
 * create transaction halfway. Field paths here match the `direct` table in
 * `fieldPathToFormField`, so each issue lands on the wizard input that caused
 * it.
 *
 * Deliberately permissive where the writer is: `extraction`, `parties` and
 * `costLines` are structural pass-throughs owned by their own types, so they
 * are carried unchanged rather than re-described (and narrowed) here.
 */
export const createProjectWithLeadSchema = z.object({
  projectName: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(255, "Project name is too long"),
  leadId: z.number().int("Select a lead").positive("Select a lead"),
  lotSize: z.coerce.number().nonnegative("Lot size cannot be negative"),
  // yyyy-MM-dd, which is what the wizard sends (format(..., "yyyy-MM-dd") in
  // create-project-modal) and what the sibling insuranceClaim dates below use.
  // A full ISO datetime is accepted too: the interface documents these as "ISO
  // string" and the writer only calls new Date(...), which parses both, so a
  // server-to-server caller is not refused over a format the writer accepts.
  startDate: handoffDateSchema("Start date is required"),
  estimatedEndDate: handoffDateSchema("Estimated end date is required"),
  address: z.string().trim().min(1, "Site location is required"),
  council: z.string().trim().min(1, "Council is required"),
  siteManagerId: z.string().trim().min(1, "Assign a site manager"),
  // Shape only: whether the owners are good enough to become customers is
  // the domain's rule (`lib/domain/projects/owners.ts`), which the wizard has
  // already run and the command runs again.
  owners: z
    .array(
      z.object({
        name: z.string().nullish(),
        email: z.string().nullish(),
        phone: z.string().nullish(),
        address: z.string().nullish(),
      }),
    )
    .nullish(),
  // Structural pass-throughs: owned by their own types and written straight
  // through, so they are carried rather than re-described here. Typed as what
  // the writer takes so the parsed payload is what it is handed.
  parties: z.custom<Prisma.InputJsonValue>().nullish(),
  extraction: z
    .custom<ProjectRequirementsPayload | ProjectExtractionData>()
    .nullish(),
  costLines: z.array(z.custom<OfferWorkspaceCostLine>()).optional(),
  sourceDocuments: z.object({
    tender: sourceDocumentSchema("tender"),
    contract: sourceDocumentSchema("contract"),
  }),
  confirmDateBlockers: z.boolean().optional(),
});

/**
 * Base project fields shared between create and update
 */
const baseProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(255, "Project name is too long"),

  propertyType: z.string().trim().optional(),

  type: z.string().trim().optional(),

  customerMode: customerModeSchema.optional(),

  location: z
    .string()
    .trim()
    .min(1, "Location is required")
    .max(255, "Location is too long"),

  startDate: isoDateStringSchema,

  estimatedEndDate: isoDateStringSchema.optional(),

  estEnd: z.string().trim().optional().nullable(),

  budget: nonNegativeSchema,

  lotSize: nonNegativeSchema,

  notes: z.string().trim().max(2000, "Notes are too long").optional(),

  siteManagerId: z.string().trim().optional().nullable(),

  customerId: z.string().trim().optional(),

  customerName: normalizedStringSchema.optional(),

  customerPhone: z.string().trim().optional(),

  customerEmail: emailSchema.optional(),
  quoteFile: z.instanceof(File).optional(),
});

// `createProjectSchema` and `CreateProjectInput` were deleted in phase 4 of
// issue #301, along with the two endpoints that parsed them.
//
// They described a "create a project from scratch" payload — customer mode,
// quote file, property type — for an operation the schema does not allow:
// `Project.leadId` is a required unique foreign key, so a project exists only
// as a converted lead. The writer behind them set `leadId: 0` with the comment
// "To make this function fail", and every POST died on a constraint violation.
// A validator for a request nothing accepts is the kind of plausible-looking
// dead code this migration keeps removing. The supported payload is
// `createProjectWithLeadSchema`, above, which the create-project wizard's
// Server Action parses.

/**
 * Update project request body
 * More lenient than create - allows partial updates
 */
export const updateProjectSchema = baseProjectSchema.partial();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ============================================================================
// Project Query/List Validators
// ============================================================================

/**
 * Tradie coordination tab filter
 */
const tradieCoordinationTabSchema = z.enum([
  "all",
  "week",
  "confirmed",
  "pending",
  "overdue",
  "completed",
]);

export type TradieCoordinationTab = z.infer<typeof tradieCoordinationTabSchema>;

/**
 * Tradie coordination sort options
 */
const tradieCoordinationSortBySchema = z.enum([
  "scheduledDate",
  "tradieName",
  "tradeType",
  "projectName",
  "status",
]);

export type TradieCoordinationSortBy = z.infer<
  typeof tradieCoordinationSortBySchema
>;

/**
 * Query for tradie coordination dashboard
 */
export const tradieCoordinationQuerySchema = z
  .object({
    mode: z.literal("coordination"),
    ...paginationSchema.shape,

    search: z.string().trim().default(""),

    projectId: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((value) => value || null),

    tradeType: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((value) => value || null),

    status: z.nativeEnum(ProjectStatus).nullable().optional().catch(undefined),

    tab: tradieCoordinationTabSchema.default("all"),

    sortBy: tradieCoordinationSortBySchema.default("scheduledDate"),

    sortOrder: sortOrderSchema.default("asc"),
  })
  .strict();

export type TradieCoordinationQuery = z.infer<
  typeof tradieCoordinationQuerySchema
>;

/**
 * Project lookup query (for dropdowns/autocomplete)
 */
export const projectLookupQuerySchema = z
  .object({
    mode: z.literal("lookup"),
    ...paginationSchema.shape,

    q: z.string().trim().default(""),
  })
  .strict();

export type ProjectLookupQuery = z.infer<typeof projectLookupQuerySchema>;

/**
 * Project list query (main project list)
 */
export const projectListQuerySchema = z
  .object({
    mode: z.string().optional(),

    status: z
      .union([
        z.enum(ProjectStatus),
        z.literal(OPEN_PROJECTS_FILTER),
        z.literal(DRAFTING_FILTER),
        z.literal(OVERDUE_FILTER),
      ])
      .optional()
      .catch(undefined),

    ...paginationSchema.shape,

    search: z.string().trim().default(""),

    sortBy: z
      .enum(["name", "progress", "budget", "startDate", "spent"] satisfies [
        ProjectListSortBy,
        ...ProjectListSortBy[],
      ])
      .optional()
      .catch(undefined),

    sortOrder: sortOrderSchema.default("asc"),
  })
  .strict();

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

// ============================================================================
// Route Parameters
// ============================================================================

/**
 * Single project by ID route param
 */
export const projectParamSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required"),
});

export type ProjectParam = z.infer<typeof projectParamSchema>;

/**
 * Project + nested resource route params
 */
export const projectNestedParamSchema = projectParamSchema.extend({
  resourceId: z.string().trim().min(1, "Resource ID is required"),
});

export type ProjectNestedParam = z.infer<typeof projectNestedParamSchema>;

/**
 * Variation route params
 */
export const variationParamSchema = projectParamSchema.extend({
  variationId: z.string().trim().min(1, "Variation ID is required"),
});

export type VariationParam = z.infer<typeof variationParamSchema>;

// ============================================================================
// Updates
// ============================================================================

/**
 * Create project update/note
 */
export const createProjectUpdateSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "Update notes are required")
    .max(5000, "Update notes are too long"),

  milestoneId: z.string().trim().optional().nullable(),

  photoUrls: z.array(z.string().url("Invalid photo URL")).optional(),
});

export type CreateProjectUpdateInput = z.infer<
  typeof createProjectUpdateSchema
>;

// ============================================================================
// Milestones
// ============================================================================

/**
 * Milestone route params
 */
export const milestoneParamSchema = projectParamSchema.extend({
  milestoneId: z.string().trim().min(1, "Milestone ID is required"),
});

export type MilestoneParam = z.infer<typeof milestoneParamSchema>;

/**
 * The project detail tabs that actually exist.
 *
 * This previously also accepted "materials", "updates" and "workers" — tabs
 * whose nav entries and render branches have both been removed. Because the
 * validator was the gate for the `?activeTab=` URL param, an unrendered tab
 * validated successfully and put the store into a state with no panel to
 * render and no tab to navigate back from. Narrowed to reality. "variations"
 * is back now that it renders again.
 */
export const projectTabsValidator = z.enum([
  "overview",
  "milestones",
  "payments",
  "financials",
  "variations",
  "tradies",
  "docs",
  "history",
  "communications",
  "compliance",
  "checklists",
]);

export type ProjectDetailTabKey = z.infer<typeof projectTabsValidator>;
/* -------------------------------------------------------------------------- */
/*                            Insurance claim dates                           */
/* -------------------------------------------------------------------------- */

/**
 * The project's insurance coverage window, captured when the first Slab-stage
 * milestone is started. Dates are `yyyy-MM-dd` to match `signedDate` and the
 * rest of the requirements payload.
 */
export const insuranceClaimDatesSchema = z
  .object({
    insuranceClaimStartDate: z.iso.date(
      "Insurance claim start date is required",
    ),
    insuranceClaimEndDate: z.iso.date("Insurance claim end date is required"),
  })
  .superRefine((data, ctx) => {
    if (
      new Date(data.insuranceClaimEndDate)
      <= new Date(data.insuranceClaimStartDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insuranceClaimEndDate"],
        message: "End date must be after the start date",
      });
    }
  });

export type InsuranceClaimDatesInput = z.infer<
  typeof insuranceClaimDatesSchema
>;
