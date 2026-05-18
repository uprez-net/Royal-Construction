import { z } from "zod";

/**
 * Common reusable validators and utilities across all API routes
 * Handles pagination, coercion, IDs, and date validation
 */

// ============================================================================
// UUID & ID Validators
// ============================================================================

/** Validates a UUID string */
export const uuidSchema = z.string().uuid();

/** Validates an arbitrary ID string (flexible format) */
export const idSchema = z.string().trim().min(1, "ID is required");

/**
 * Route param validator for UUIDs
 * Used for [id], [projectId], [scheduleId], etc.
 */
export const uuidParamSchema = z.object({
  id: uuidSchema,
});

// ============================================================================
// Pagination Validators
// ============================================================================

/** Standard pagination defaults */
export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 10,
  maxLimit: 100,
} as const;

/**
 * Base pagination schema with sane defaults and bounds
 * Apply this to all list endpoints with limit/page/search
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int("Page must be an integer")
    .positive("Page must be greater than 0")
    .default(PAGINATION_DEFAULTS.page),

  limit: z.coerce
    .number()
    .int("Limit must be an integer")
    .positive("Limit must be greater than 0")
    .max(PAGINATION_DEFAULTS.maxLimit, `Limit cannot exceed ${PAGINATION_DEFAULTS.maxLimit}`)
    .default(PAGINATION_DEFAULTS.limit),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * Search pagination schema - pagination + searchable query
 */
export const searchPaginationSchema = paginationSchema.extend({
  search: z
    .string()
    .trim()
    .default(""),

  q: z
    .string()
    .trim()
    .default(""),
});

export type SearchPaginationInput = z.infer<typeof searchPaginationSchema>;

/**
 * Query schema - pagination + search + sorting
 */
export const sortOrderSchema = z.enum(["asc", "desc"]);

export type SortOrder = z.infer<typeof sortOrderSchema>;

export const querySchema = searchPaginationSchema.extend({
  sortBy: z.string().optional(),
  sortOrder: sortOrderSchema.default("asc"),
});

export type QueryInput = z.infer<typeof querySchema>;

// ============================================================================
// Date Validators
// ============================================================================

/**
 * Validates ISO date strings and date objects
 * Parses to Date instance
 */
export const isoDateSchema = z
  .string()
  .trim()
  .or(z.date())
  .pipe(z.coerce.date())
  .refine((date) => !Number.isNaN(date.getTime()), "Invalid date");

/**
 * Optional ISO date that allows null/empty values
 */
export const optionalIsoDateSchema = z
  .union([
    z.string().trim().pipe(z.coerce.date()),
    z.date(),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((val) => {
    if (!val || (typeof val === "string" && val === "")) return null;
    if (val instanceof Date) return val;
    if (typeof val === "string") {
      try {
        const date = new Date(val);
        return Number.isNaN(date.getTime()) ? null : date;
      } catch {
        return null;
      }
    }
    return null;
  });

/**
 * Date range validator for filter queries
 */
export const dateRangeSchema = z
  .object({
    startDate: optionalIsoDateSchema,
    endDate: optionalIsoDateSchema,
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return data.startDate <= data.endDate;
    },
    "Start date must be before end date"
  );

export type DateRange = z.infer<typeof dateRangeSchema>;

// ============================================================================
// Numeric Coercion
// ============================================================================

/**
 * Safely coerce string numbers to integers
 * Returns undefined if parsing fails
 */
export const coerceIntSchema = z.coerce
  .number()
  .int("Must be an integer")
  .optional()

/**
 * Safely coerce string numbers to floats
 * Returns undefined if parsing fails
 */
export const coerceNumberSchema = z.coerce
  .number()
  .finite("Must be a finite number")
  .optional()

/**
 * Positive integer (common for IDs, counts)
 */
export const positiveIntSchema = z.coerce
  .number()
  .int()
  .positive("Must be a positive integer");

/**
 * Non-negative number (budget, size)
 */
export const nonNegativeSchema = z.coerce
  .number()
  .finite("Must be a valid number")
  .nonnegative("Cannot be negative");

// ============================================================================
// String Coercion & Normalization
// ============================================================================

/**
 * Trim and normalize strings, converting empty to undefined
 */
export const normalizedStringSchema = z
  .string()
  .trim()
  .transform((val) => (val.length === 0 ? undefined : val));

/**
 * Email validator (strict)
 */
export const emailSchema = z
  .string()
  .trim()
  .email("Invalid email address")
  .toLowerCase();

/**
 * URL validator
 */
export const urlSchema = z
  .string()
  .trim()
  .url("Invalid URL");

/**
 * Phone number validator (basic - non-empty string)
 * More sophisticated validation can be added with libphonenumber-js if needed
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone number is too short")
  .max(20, "Phone number is too long");

// ============================================================================
// Boolean Coercion
// ============================================================================

/**
 * Safely coerce string booleans to boolean
 * Accepts: "true", "false", "1", "0", true, false
 */
export const coerceBoolSchema = z
  .union([
    z.boolean(),
    z.enum(["true", "false", "1", "0"]).transform((val) =>
      val === "true" || val === "1"
    ),
  ])
  .default(false);

// ============================================================================
// Enum Validators
// ============================================================================

/**
 * Create a safe enum validator that catches invalid values
 * Returns undefined instead of throwing on invalid enum
 */
export function safeEnumSchema<T extends Record<string, any>>(
  enumObj: T
): z.ZodType<T[keyof T] | undefined> {
  return z.nativeEnum(enumObj).optional();
}

/**
 * Create optional enum validator
 */
export function optionalEnumSchema<T extends Record<string, any>>(
  enumObj: T
): z.ZodType<T[keyof T] | undefined | null> {
  return z
    .union([z.nativeEnum(enumObj), z.literal(""), z.null()])
    .optional()
    .transform((val) => (val === "" || val === null ? null : val));
}

// ============================================================================
// Response Shapes (for standardized API responses)
// ============================================================================

/**
 * Standard error response shape
 */
export const errorResponseSchema = z.object({
  error: z.string(),
  issues: z.record(z.string(), z.any()).optional(),
  details: z.string().optional(),
});

/**
 * Standard validation error response
 */
export const validationErrorSchema = z.object({
  error: z.literal("Invalid request data"),
  issues: z.record(z.string(), z.any()),
});

/**
 * Standard paginated list response wrapper
 */
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  });

// ============================================================================
// Utilities for route handlers
// ============================================================================

/**
 * Parse and validate URL search parameters
 */
export function parseSearchParams(
  url: URL,
  schema: z.ZodSchema
): ReturnType<typeof schema.safeParse> {
  const obj: Record<string, string | string[] | undefined> = {};

  url.searchParams.forEach((value, key) => {
    if (obj[key]) {
      // Handle multiple values for same key
      const existing = obj[key];
      obj[key] = Array.isArray(existing) ? [...existing, value] : [existing as string, value];
    } else {
      obj[key] = value;
    }
  });

  return schema.safeParse(obj);
}

/**
 * Parse and validate route params
 */
export function parseRouteParams(
  params: Record<string, any>,
  schema: z.ZodSchema
): ReturnType<typeof schema.safeParse> {
  return schema.safeParse(params);
}

/**
 * Safe JSON parse wrapper
 */
export async function safeParseBody<T extends z.ZodSchema>(
  request: Request,
  schema: T
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; error: z.ZodError<any> }
> {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return { success: false, error: parsed.error };
    }
    return { success: true, data: parsed.data };
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [],
          message: "Invalid JSON in request body",
        },
      ]),
    };
  }
}
