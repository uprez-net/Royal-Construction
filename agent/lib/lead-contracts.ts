import { z } from "zod";
import { leadSources, leadStages } from "@/utils/validators/lead";

export const leadIdSchema = z.number().int().positive();
export const leadTaskIdSchema = z.number().int().positive();

// One tool for finding a lead and for listing the pipeline: an empty query
// lists every non-archived lead (`includeArchived` adds the archived ones),
// `page` walks the rest, and the result carries the total.
export const searchLeadsInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  stages: z.array(z.enum(leadStages)).max(leadStages.length).default([]),
  includeArchived: z.boolean().default(false),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(50).default(10),
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

export const listOverdueLeadTasksInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
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

const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const dateOnlyOrInstant = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T.+)?$/,
    "Use YYYY-MM-DD or an ISO 8601 date-time.",
  );
const time24 = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm format.");

// The client's own details, exactly as the user gave them. Notes are not
// here: the lead's notes are a rich-text document the lead page edits, and a
// plain-text write would leave the two disagreeing.
export const createLeadInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: optionalText(40),
  location: optionalText(300),
  secondaryName: optionalText(200),
  secondaryEmail: z.string().trim().email().max(320).optional(),
  secondaryPhone: optionalText(40),
  source: z.enum(leadSources).optional(),
  sourceDetail: optionalText(300),
  projectTypes: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  budget: optionalText(80),
  estimatedValue: z.number().nonnegative().lt(1e12).optional(),
  expectedCloseDate: dateOnlyOrInstant.optional(),
  urgent: z.boolean().optional(),
});

export const updateLeadInputSchema = z.object({
  leadId: leadIdSchema,
  changes: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      email: z.string().trim().email().max(320).optional(),
      phone: nullableText(40),
      location: nullableText(300),
      secondaryName: nullableText(200),
      secondaryEmail: z.string().trim().email().max(320).nullable().optional(),
      secondaryPhone: nullableText(40),
      source: z.enum(leadSources).nullable().optional(),
      sourceDetail: nullableText(300),
      projectTypes: z
        .array(z.string().trim().min(1).max(80))
        .max(10)
        .optional(),
      budget: nullableText(80),
      estimatedValue: z.number().nonnegative().lt(1e12).nullable().optional(),
      expectedCloseDate: dateOnlyOrInstant.nullable().optional(),
      estimatedStartDate: dateOnlyOrInstant.nullable().optional(),
      stage: z.enum(leadStages).optional(),
      lostReason: nullableText(1_000),
      urgent: z.boolean().optional(),
      meetingDate: dateOnlyOrInstant.nullable().optional(),
      meetingTime: time24.nullable().optional(),
      meetingMode: z.enum(["Online", "Offline"]).nullable().optional(),
      followupDate: dateOnlyOrInstant.nullable().optional(),
      followupTime: time24.nullable().optional(),
      followupNotes: nullableText(1_000),
      assignedUserId: z.string().trim().min(1).max(100).nullable().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: "Name at least one field to change.",
    }),
});

export const archiveLeadInputSchema = z.object({
  leadId: leadIdSchema,
});

// The body is sent as the user wrote it. Plain text, with blank lines between
// paragraphs and **bold**, is what the lead composer accepts too.
export const sendLeadEmailInputSchema = z.object({
  leadId: leadIdSchema,
  to: z.string().trim().email().max(320),
  body: z.string().trim().min(1).max(10_000),
});
