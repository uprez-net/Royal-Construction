import { ProjectStatus } from "@prisma/client";
import { z } from "zod";
import { ProjectListSortBy } from "@/lib/data/projects";
import {
  emailSchema,
  isoDateSchema,
  nonNegativeSchema,
  normalizedStringSchema,
  optionalIsoDateSchema,
  paginationSchema,
  sortOrderSchema,
} from "./common";

/**
 * Project-related validators
 * Covers project CRUD, filtering, and queries
 */

// ============================================================================
// Project Creation & Updates
// ============================================================================

const customerModeSchema = z.enum(["existing", "new"]);

/**
 * Base project fields shared between create and update
 */
const baseProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(255, "Project name is too long"),

  propertyType: z
    .string()
    .trim()
    .optional(),

  type: z
    .string()
    .trim()
    .optional(),

  customerMode: customerModeSchema.optional(),

  location: z
    .string()
    .trim()
    .min(1, "Location is required")
    .max(255, "Location is too long"),

  startDate: isoDateSchema,

  estimatedEndDate: optionalIsoDateSchema,

  estEnd: z
    .string()
    .trim()
    .optional()
    .nullable(),

  budget: nonNegativeSchema,

  lotSize: nonNegativeSchema,

  notes: z
    .string()
    .trim()
    .max(2000, "Notes are too long")
    .optional(),

  siteManagerId: z
    .string()
    .trim()
    .optional()
    .nullable(),

  customerId: z
    .string()
    .trim()
    .optional(),

  customerName: normalizedStringSchema.optional(),

  customerPhone: z
    .string()
    .trim()
    .optional(),

  customerEmail: emailSchema.optional(),
  quoteFile: z
    .instanceof(File)
    .optional(),
});

/**
 * Create project request body
 * Requires customer information (either existing or new)
 */
export const createProjectSchema = baseProjectSchema
  .transform((data) => ({
    ...data,
    propertyType:
      data.propertyType?.trim() ||
      data.type?.trim() ||
      "Custom Build",

    customerMode:
      data.customerMode ??
      (data.customerId ? "existing" : "new"),

    estimatedEndDate:
      data.estimatedEndDate ??
      data.estEnd ??
      null,
  }))
  .superRefine((data, ctx) => {
    if (data.customerMode === "existing") {
      if (!data.customerId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerId"],
          message: "Customer ID is required when using existing customer",
        });
      }
    }

    if (data.customerMode === "new") {
      if (!data.customerName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerName"],
          message: "Customer name is required",
        });
      }

      if (!data.customerPhone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerPhone"],
          message: "Customer phone is required",
        });
      }

      if (!data.customerEmail?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerEmail"],
          message: "Customer email is required",
        });
      }

      if (!data.quoteFile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quoteFile"],
          message: "Quote file is required",
        });
      }
    }
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

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

export type TradieCoordinationSortBy = z.infer<typeof tradieCoordinationSortBySchema>;

/**
 * Query for tradie coordination dashboard
 */
export const tradieCoordinationQuerySchema = z
  .object({
    mode: z.literal("coordination"),
    ...paginationSchema.shape,

    search: z
      .string()
      .trim()
      .default(""),

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

    status: z
      .nativeEnum(ProjectStatus)
      .nullable()
      .optional()
      .catch(undefined),

    tab: tradieCoordinationTabSchema.default("all"),

    sortBy: tradieCoordinationSortBySchema.default("scheduledDate"),

    sortOrder: sortOrderSchema.default("asc"),
  })
  .strict();

export type TradieCoordinationQuery = z.infer<typeof tradieCoordinationQuerySchema>;

/**
 * Project lookup query (for dropdowns/autocomplete)
 */
export const projectLookupQuerySchema = z
  .object({
    mode: z.literal("lookup"),
    ...paginationSchema.shape,

    q: z
      .string()
      .trim()
      .default(""),
  })
  .strict();

export type ProjectLookupQuery = z.infer<typeof projectLookupQuerySchema>;

/**
 * Project list query (main project list)
 */
export const projectListQuerySchema = z
  .object({
    mode: z
      .string()
      .optional(),

    status: z
      .nativeEnum(ProjectStatus)
      .optional()
      .catch(undefined),

    ...paginationSchema.shape,

    search: z
      .string()
      .trim()
      .default(""),

    sortBy: z
      .enum([
        "name",
        "progress",
        "budget",
        "startDate",
        "spent",
      ] satisfies [ProjectListSortBy, ...ProjectListSortBy[]])
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

// ============================================================================
// Variations
// ============================================================================

/**
 * Create project variation
 */
export const createVariationSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(2000, "Description is too long"),

  cost: nonNegativeSchema,

  requestedDate: optionalIsoDateSchema,
});

export type CreateVariationInput = z.infer<typeof createVariationSchema>;

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

  milestoneId: z
    .string()
    .trim()
    .optional()
    .nullable(),

  photoUrls: z
    .array(z.string().url("Invalid photo URL"))
    .optional(),
});

export type CreateProjectUpdateInput = z.infer<typeof createProjectUpdateSchema>;

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
