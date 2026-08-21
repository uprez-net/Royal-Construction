import { z } from "zod";

/** Mirrors the Prisma enum. Kept as a literal list so a schema drift is a
 *  compile error at the call site rather than a runtime 500. */
export const leadTaskTypes = ["CALL", "EMAIL", "MEETING", "WAITING"] as const;

export const createLeadTaskSchema = z.object({
  leadId: z.number().int().positive(),
  type: z.enum(leadTaskTypes),
  // Nullable on purpose: "no date yet" is a real state, and it is the one 5
  // production leads are parked in while the UI claims everything is caught up.
  dueDate: z.iso.datetime().nullable(),
  // HH:mm, matching the existing followupTime/meetingTime strings on Lead.
  // max(10) accepted "banana" and "99:99", which would render as-is on a row.
  dueTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm")
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreateLeadTaskBody = z.infer<typeof createLeadTaskSchema>;

export const leadTaskParamSchema = z.object({
  taskId: z.string().trim().regex(/^\d+$/, "Task id must be numeric"),
});
