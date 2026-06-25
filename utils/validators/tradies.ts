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
});

export type CreateTradieScheduleInput = z.infer<typeof createTradieScheduleSchema>;

/**
 * Update tradie schedule status
 */
export const updateTradieScheduleSchema = z.object({
  status: z.nativeEnum(TradieScheduleStatus, {
    error: () => ({
      message: `Status must be one of: ${Object.values(TradieScheduleStatus).join(", ")}`,
    }),
  }),
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
