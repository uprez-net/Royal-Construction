import { z } from "zod";

export const leadIdSchema = z.number().int().positive();
export const leadTaskIdSchema = z.number().int().positive();

export const searchLeadsInputSchema = z.object({
  query: z.string().trim().min(2).max(120),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(10).default(5),
});

export const getLeadInputSchema = z.object({
  leadId: leadIdSchema,
  historyLimit: z.number().int().min(0).max(20).default(10),
});

export const listLeadTasksInputSchema = z.object({
  leadId: leadIdSchema,
  state: z.enum(["open", "completed", "all"]).default("open"),
  limit: z.number().int().min(1).max(50).default(20),
});

export const createLeadTaskInputSchema = z.object({
  leadId: leadIdSchema,
  type: z.enum(["CALL", "EMAIL", "MEETING", "WAITING", "WHATSAPP"]),
  dueAt: z.string().datetime({ offset: true }),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm format.")
    .optional(),
  notes: z.string().trim().max(1_000).optional(),
});

export const changeLeadTaskStateInputSchema = z.object({
  taskId: leadTaskIdSchema,
});

export const sendLeadEmailInputSchema = z.object({
  leadId: leadIdSchema,
  to: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});
