import { z } from "zod";
import { emailSchema } from "./common";

/**
 * Graph API and Webhook validators
 * Microsoft Graph integration and Clerk webhook validation
 */

// ============================================================================
// Graph Endpoints
// ============================================================================

/**
 * Graph token request body
 */
export const graphTokenRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Authorization code is required"),

  redirectUri: z
    .string()
    .trim()
    .url("Invalid redirect URI"),
});

export type GraphTokenRequest = z.infer<typeof graphTokenRequestSchema>;

/**
 * Graph send email request
 */
export const graphSendEmailSchema = z.object({
  to: z
    .union([
      emailSchema,
      z.array(emailSchema).min(1, "At least one recipient is required"),
    ])
    .transform((val) => (Array.isArray(val) ? val : [val])),

  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(255, "Subject is too long"),

  body: z
    .string()
    .min(1, "Body is required")
    .max(100000, "Body is too long"),

  isHtml: z
    .boolean()
    .default(false),

  cc: z
    .array(emailSchema)
    .optional(),

  bcc: z
    .array(emailSchema)
    .optional(),

  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        contentBytes: z.string(), // base64
      })
    )
    .optional(),
});

export type GraphSendEmailInput = z.infer<typeof graphSendEmailSchema>;

/**
 * Graph subscribe endpoint
 */
export const graphSubscribeSchema = z.object({
  resource: z
    .string()
    .trim()
    .min(1, "Resource path is required"),

  changeType: z
    .enum(["created", "updated", "deleted"])
    .or(z.string()),

  notificationUrl: z
    .string()
    .url("Invalid notification URL"),

  expirationDateTime: z
    .string()
    .datetime()
    .optional(),
});

export type GraphSubscribeInput = z.infer<typeof graphSubscribeSchema>;

/**
 * Graph notifications webhook payload
 */
export const graphNotificationSchema = z.object({
  subscriptionId: z.string(),
  changeType: z.enum(["created", "updated", "deleted"]),
  resource: z.string(),
  resourceData: z.record(z.string(), z.any()).optional(),
  encryptedContent: z
    .object({
      data: z.string(),
      dataKey: z.string(),
      encryptionCertificateId: z.string(),
    })
    .optional(),
});

export type GraphNotification = z.infer<typeof graphNotificationSchema>;

/**
 * List emails query
 */
export const graphEmailsListQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive()
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(50)
    .default(20),

  search: z
    .string()
    .trim()
    .optional(),

  from: z
    .string()
    .trim()
    .optional(),

  folder: z
    .enum(["inbox", "sent", "drafts", "deleted"])
    .optional(),
});

export type GraphEmailsListQuery = z.infer<typeof graphEmailsListQuerySchema>;

// ============================================================================
// Clerk Webhooks
// ============================================================================

/**
 * Clerk webhook event types
 */
export const clerkEventTypeSchema = z.enum([
  "user.created",
  "user.updated",
  "user.deleted",
  "session.created",
  "session.removed",
  "organization.created",
  "organization.updated",
  "organization.deleted",
]);

export type ClerkEventType = z.infer<typeof clerkEventTypeSchema>;

/**
 * Clerk user event data
 */
export const clerkUserEventSchema = z.object({
  data: z
    .object({
      id: z.string(),
      email_addresses: z
        .array(
          z.object({
            email_address: emailSchema,
            primary: z.boolean().optional(),
          })
        )
        .optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional(),
      profile_image_url: z.string().url().optional(),
      created_at: z.number(),
      updated_at: z.number(),
    })
    .passthrough(), // Allow additional Clerk fields
  type: z.literal("user.created").or(z.literal("user.updated")).or(z.literal("user.deleted")),
  object: z.literal("event"),
  id: z.string(),
  created_at: z.number(),
});

export type ClerkUserEvent = z.infer<typeof clerkUserEventSchema>;

/**
 * Generic Clerk webhook event envelope
 */
export const clerkWebhookEventSchema = z.object({
  type: clerkEventTypeSchema,
  data: z.record(z.string(), z.any()),
  object: z.literal("event"),
  id: z.string(),
  created_at: z.number(),
});

export type ClerkWebhookEvent = z.infer<typeof clerkWebhookEventSchema>;

// ============================================================================
// Cron Jobs
// ============================================================================

/**
 * Cron job trigger validation
 */
export const cronTriggerSchema = z.object({
  secret: z
    .string()
    .trim()
    .min(1, "Cron secret is required"),

  timestamp: z
    .number()
    .int()
    .optional(),
});

export type CronTrigger = z.infer<typeof cronTriggerSchema>;

/**
 * Tradie reminder cron payload
 */
export const tradiReminderCronSchema = cronTriggerSchema.extend({
  daysOffset: z
    .number()
    .int()
    .default(0),
});

export type TradieReminderCron = z.infer<typeof tradiReminderCronSchema>;
