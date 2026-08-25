import { TradieScheduleStatus } from "@prisma/client";
import { z } from "zod";
import {
  isoDateStringSchema,
  optionalEnumSchema,
} from "./common";

/**
 * Tradie and schedule-related validators
 */

// ============================================================================
// Tradies
// ============================================================================

/**
 * Tradie search query (for dropdowns/lookups)
 */
export const tradieSearchQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .default(""),

  q: z
    .string()
    .trim()
    .default(""),

  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(20),

  page: z.coerce
    .number()
    .int()
    .positive()
    .default(1),
});

export type TradieSearchQuery = z.infer<typeof tradieSearchQuerySchema>;

/**
 * Tradie route params
 */
export const tradieParamSchema = z.object({
  tradieId: z.string().trim().min(1, "Tradie ID is required"),
});

export type TradieParam = z.infer<typeof tradieParamSchema>;

// ============================================================================
// Tradie Schedules
// ============================================================================

/**
 * Create tradie schedule
 */
export const createTradieScheduleSchema = z.object({
  tradieId: z
    .string()
    .trim()
    .min(1, "Tradie ID is required"),

  projectId: z
    .string()
    .trim()
    .min(1, "Project ID is required"),

  milestoneId: z
    .string()
    .trim()
    .optional(),

  scheduledDate: isoDateStringSchema,

  durationDays: z.coerce
    .number()
    .int("Duration must be a whole number")
    .positive("Duration must be greater than 0")
    .optional()
    .default(1),

  requiresQuote: z.boolean().optional().default(false),

  emailContent: z.object({
    subject: z.string().trim().min(1, "Email subject is required"),
    body: z.string().trim().min(1, "Email body is required"),
    attachments: z.array(
      z.object({
        name: z.string().trim().min(1, "Attachment name is required"),
        url: z.string().trim().url("Attachment URL must be a valid URL"),
      })
    ).default([]),
  }).optional(),
});

export type CreateTradieScheduleInput = z.infer<typeof createTradieScheduleSchema>;

/**
 * Update tradie schedule status
 */
export const updateTradieScheduleSchema = z.object({
  status: z.enum(TradieScheduleStatus, {
    error: () => ({
      message: `Status must be one of: ${Object.values(TradieScheduleStatus).join(", ")}`,
    }),
  }),
  quote: z.string().optional(),
  /**
   * How to read `quote`. Tradies quote by the hour and by the day as often as
   * they quote a lump sum, so the amount alone is ambiguous - $950 is a
   * plausible day rate AND a plausible small job. Defaults to FIXED at the
   * point of use: a caller that names a price for one scheduled job and says
   * nothing else means the job.
   */
  quoteUnit: z.enum(["FIXED", "HOURLY", "DAILY"]).optional(),
});

export type UpdateTradieScheduleInput = z.infer<typeof updateTradieScheduleSchema>;

/**
 * Tradie schedule route params
 */
export const scheduleParamSchema = z.object({
  scheduleId: z.string().trim().min(1, "Schedule ID is required"),
});

export type ScheduleParam = z.infer<typeof scheduleParamSchema>;

/**
 * Tradie schedule status filter for queries
 */
export const scheduleStatusFilterSchema = z
  .object({
    status: optionalEnumSchema(TradieScheduleStatus),
  })
  .partial();

export type ScheduleStatusFilter = z.infer<typeof scheduleStatusFilterSchema>;

// ============================================================================
// Tradie Coordination Dashboard
// ============================================================================

/**
 * Query for tradie coordination dashboard list
 */
export const tradieCoordinationListQuerySchema = z
  .object({
    mode: z.literal("coordination"),
    page: z.coerce
      .number()
      .int()
      .positive()
      .default(1),

    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(10),

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

    status: optionalEnumSchema(TradieScheduleStatus),

    tab: z
      .enum(["all", "week", "confirmed", "pending", "overdue", "completed"])
      .default("all"),

    sortBy: z
      .enum(["scheduledDate", "tradieName", "tradeType", "projectName", "status"])
      .default("scheduledDate"),

    sortOrder: z
      .enum(["asc", "desc"])
      .default("asc"),
  })
  .strict();

export type TradieCoordinationListQuery = z.infer<typeof tradieCoordinationListQuerySchema>;
