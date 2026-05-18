import { z } from "zod";
import {
  emailSchema,
  paginationSchema,
  phoneSchema,
} from "./common";

/**
 * Customer and Site Manager query validators
 */

// ============================================================================
// Customer Queries
// ============================================================================

/**
 * Customer dropdown/lookup query
 * Used for searching and filtering customers in lists
 */
export const customerLookupQuerySchema = z
  .object({
    ...paginationSchema.shape,

    q: z
      .string()
      .trim()
      .default(""),

    search: z
      .string()
      .trim()
      .default(""),
  })
  .strict();

export type CustomerLookupQuery = z.infer<typeof customerLookupQuerySchema>;

/**
 * Customer route params
 */
export const customerParamSchema = z.object({
  customerId: z.string().trim().min(1, "Customer ID is required"),
});

export type CustomerParam = z.infer<typeof customerParamSchema>;

// ============================================================================
// Site Manager Queries
// ============================================================================

/**
 * Site Manager dropdown/lookup query
 */
export const siteManagerLookupQuerySchema = z
  .object({
    ...paginationSchema.shape,

    q: z
      .string()
      .trim()
      .default(""),

    search: z
      .string()
      .trim()
      .default(""),
  })
  .strict();

export type SiteManagerLookupQuery = z.infer<typeof siteManagerLookupQuerySchema>;

/**
 * Site Manager route params
 */
export const siteManagerParamSchema = z.object({
  siteManagerId: z.string().trim().min(1, "Site Manager ID is required"),
});

export type SiteManagerParam = z.infer<typeof siteManagerParamSchema>;

// ============================================================================
// Customer Creation (for projects)
// ============================================================================

/**
 * Create customer inline (when creating a project with new customer)
 */
export const createCustomerInlineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Customer name is required")
    .max(255, "Customer name is too long"),

  phone: phoneSchema,

  email: emailSchema,
});

export type CreateCustomerInline = z.infer<typeof createCustomerInlineSchema>;
