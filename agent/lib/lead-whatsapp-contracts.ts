import { z } from "zod";

import { leadIdSchema } from "@/agent/lib/lead-contracts";

// Eve's WhatsApp tool inputs (issue #333).
//
// Shape only. Whether the lead may be messaged, from which number, in which
// mode, and whether this call already sent is decided by
// lib/domain/leads/whatsapp — the same command the App's composer calls. There
// is deliberately no recipient field: the destination is always the lead's own
// primary phone, resolved server-side, so a model cannot address anyone else.

/** Meta's text limit; the domain enforces it again. */
const MAX_TEXT = 4_096;

const businessPhoneNumberIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, "Use the numeric WhatsApp phone_number_id.");

const templateNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,512}$/, "Use the template's WhatsApp Manager name.");

const templateParameterSchema = z.string().trim().min(1).max(200);

export const getLeadWhatsAppInputSchema = z.object({
  leadId: leadIdSchema,
  /** How many of the most recent messages to return. 0 returns the summary only. */
  limit: z.number().int().min(0).max(20).default(10),
});

const whatsappMessageShape = {
  leadId: leadIdSchema,
  mode: z.enum(["text", "template"]),
  /** The free-form message, for mode "text". */
  body: z.string().trim().min(1).max(MAX_TEXT).optional(),
  /** The approved template, for mode "template". */
  templateName: templateNameSchema.optional(),
  /** Template variables in order: {{1}}, {{2}}, … */
  templateParameters: z.array(templateParameterSchema).max(10).optional(),
  /** Override the Royal sender number. Omit to let the domain choose. */
  businessPhoneNumberId: businessPhoneNumberIdSchema.optional(),
};

function requireModeFields(
  value: {
    body?: string;
    mode: "text" | "template";
    templateName?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (value.mode === "text" && !value.body) {
    ctx.addIssue({
      code: "custom",
      message: "A text message needs a body.",
      path: ["body"],
    });
  }
  if (value.mode === "template" && !value.templateName) {
    ctx.addIssue({
      code: "custom",
      message: "A template message needs a templateName.",
      path: ["templateName"],
    });
  }
}

export const prepareLeadWhatsAppMessageInputSchema = z
  .object(whatsappMessageShape)
  .superRefine(requireModeFields);

export const sendLeadWhatsAppMessageInputSchema = z
  .object(whatsappMessageShape)
  .superRefine(requireModeFields);

export type LeadWhatsAppMessageInput = z.infer<
  typeof sendLeadWhatsAppMessageInputSchema
>;

export const scheduleLeadWhatsAppFollowUpInputSchema = z.object({
  leadId: leadIdSchema,
  dueAt: z.string().datetime({ offset: true }),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm format.")
    .optional(),
  notes: z.string().trim().max(1_000).optional(),
});
