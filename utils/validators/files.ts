import { z } from "zod";

/**
 * File upload and address validators
 */

// ============================================================================
// File Upload
// ============================================================================

/**
 * File upload metadata validation
 */
export const fileUploadMetadataSchema = z.object({
  fileId: z
    .string()
    .trim()
    .optional(),

  fileName: z
    .string()
    .trim()
    .min(1, "File name is required")
    .max(255, "File name is too long"),

  projectId: z
    .string()
    .trim()
    .min(1, "Project ID is required"),

  milestoneId: z
    .string()
    .trim()
    .optional()
    .nullable(),
});

export type FileUploadMetadata = z.infer<typeof fileUploadMetadataSchema>;

/**
 * Allowed MIME types for uploads
 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",

  // PDF
  "application/pdf",

  // Microsoft Word
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx

  // Excel
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx

  // CSV
  "text/csv",
  "application/csv",
  "text/plain",
] as const;

export const uploadMimeTypeSchema = z.enum(ALLOWED_UPLOAD_MIME_TYPES);

export type UploadMimeType = z.infer<typeof uploadMimeTypeSchema>;

/**
 * Upload token payload (server-side verification)
 */
export const uploadTokenPayloadSchema = fileUploadMetadataSchema.extend({
  userId: z
    .string()
    .trim()
    .min(1, "User ID is required"),
});

export type UploadTokenPayload = z.infer<typeof uploadTokenPayloadSchema>;

/**
 * File validation constraints
 */
export const UPLOAD_CONSTRAINTS = {
  maxFileSizeBytes: 40 * 1024 * 1024, // 40MB
  maxFileNameLength: 255,
  allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
} as const;

// ============================================================================
// Address Lookup
// ============================================================================

/**
 * Address autocomplete/search query
 */
export const addressSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Search query must be at least 2 characters")
    .max(255, "Search query is too long"),

  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(20)
    .default(8),

  country: z
    .string()
    .trim()
    .length(2, "Country code must be 2 characters")
    .default("AU"),
});

export type AddressSearchQuery = z.infer<typeof addressSearchQuerySchema>;

/**
 * Address suggestion from autocomplete
 */
export const addressSuggestionSchema = z.object({
  placeId: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  council: z.string().optional(),
  state: z.string().optional(),
});

export type AddressSuggestion = z.infer<typeof addressSuggestionSchema>;

/**
 * Paginated address suggestions response
 */
export const addressSuggestionsResponseSchema = z.object({
  suggestions: z.array(addressSuggestionSchema),
  count: z.number(),
});

export type AddressSuggestionsResponse = z.infer<typeof addressSuggestionsResponseSchema>;

/**
 * Client payload schema - validated before token generation
 */
export const clientPayloadSchema = z.object({
    fileId: z.string().optional(),
    fileName: z.string().trim().min(1, 'File name is required').max(255),
    fileSize: z.number().max(UPLOAD_CONSTRAINTS.maxFileSizeBytes, `File size must be less than ${UPLOAD_CONSTRAINTS.maxFileSizeBytes} bytes`),
    projectId: z.string().trim().min(1, 'Project ID is required').optional(),
    milestoneId: z.string().trim().optional().nullable(),
    leadId: z.coerce.string().trim().optional(),
    offerId: z.coerce.string().trim().optional(),
});

export type ClientPayload = z.infer<typeof clientPayloadSchema>;

/**
 * Token payload schema - validated on completion
 */
export const tokenPayloadSchema = clientPayloadSchema.extend({
    userId: z.string().min(1, 'User ID is required'),
});

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;