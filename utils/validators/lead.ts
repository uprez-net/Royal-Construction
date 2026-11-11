import { z } from "zod";
import { LEAD_LIST_SORT_VALUES } from "@/lib/leads/list-sort";

import type { LeadSource, LeadStage } from "@/lib/leads/types";
import { paginationSchema } from "./common";

export const leadStages = [
  "New",
  "Contacted",
  "Discovery",
  "Qualified",
  "Quoted",
  "Negotiating",
  "Won",
  "Lost",
  "Meeting Scheduled",
  "In Follow-up",
  "No Response",
  "Converted",
  "Cancelled",
  "Disqualified",
] as const satisfies readonly LeadStage[];

export const leadSources = [
  "Google Ads",
  "Referral",
  "Facebook Ads",
  "Walk-in",
  "Repeat Client",
  "Website",
  "Personal",
  "Business",
] as const satisfies readonly LeadSource[];

const nullableTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

// Issue #110: the primary client email is mandatory + valid on creation and
// cannot be cleared on update (required-when-present). Secondary/owner emails
// are enforced later at the offer send/sign gates (see lib/offer/offer-review).
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Exported so the data-layer createLead can re-validate at the DB boundary —
// direct callers (e.g. the consultation-booking route) bypass createLeadSchema
// and only null-checked truthiness, letting a malformed address through (#110).
export const requiredLeadEmail = z
  .string()
  .trim()
  .min(1, "Client email is required")
  .regex(emailPattern, "Enter a valid client email");

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTimeInput = z.iso.datetime();

function parseDateOnlyInput(value: string): Date | null {
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

const nullableDateInput = z.preprocess((value) => {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const dateOnly = parseDateOnlyInput(trimmed);
  if (dateOnly) return dateOnly.toISOString();

  if (!isoDateTimeInput.safeParse(trimmed).success) {
    return value;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toISOString();
}, z.iso.datetime().nullable());

const typeSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}, z.array(z.string()));

export const historyItemSchema = z.object({
  action: z.string().trim().min(1),
  detail: z.string().optional().default(""),
  type: z
    .enum(["system", "call", "email", "referral"])
    .optional()
    .default("system"),
  date: z.string(),
  time: z.string().optional(),
});

const typeArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}, z.array(z.string()));

// const dateSchema = z.preprocess((value) => {
//   if (typeof value !== "string" || value.trim() === "") {
//     return null;
//   }

//   const parsed = new Date(value);

//   if (Number.isNaN(parsed.getTime())) {
//     return null;
//   }

//   return parsed;
// }, z.date().nullable());

const leadRichTextDocumentSchema = z.object({
  version: z.literal(1),
  html: z.string(),
  plainText: z.string(),
  value: z.array(z.unknown()),
});

const leadNoteAnnotationInputSchema = z.object({
  selectedText: z.string().trim().min(1).max(1000),
  comment: z.string().trim().min(1).max(5000),
  mentionedUserIds: z.array(z.string().trim().min(1)).default([]),
});

export const historySchema = z.object({
  action: z.string().trim().min(1),
  detail: z.string().optional().default(""),
  type: z
    .enum(["system", "call", "email", "referral"])
    .optional()
    .default("system"),
  actionDate: z.iso.datetime().nullable().describe("Action date").optional(),
});

/**
 * Deal-economics fields, spread into BOTH lead schemas below.
 *
 * createLeadSchema and updateLeadSchema are independent object literals —
 * update is NOT derived via .partial() — and PATCH parses against
 * updateLeadSchema. Zod strips unknown keys silently, so a field added to only
 * one schema vanishes on the other path with no error. Sharing the definition
 * makes that class of mistake impossible.
 */
const dealEconomicsFields = {
  // Must actually validate: `new Prisma.Decimal("1,200")` throws, and an
  // unvalidated string arm would turn a typo into a 500 that discards every
  // other field in the same request. MAX matches the Decimal(14,2) column.
  estimatedValue: z
    .union([z.number(), z.string()])
    .nullable()
    .optional()
    .refine(
      (value) => {
        if (value === null || value === undefined || value === "") return true;
        const numeric =
          typeof value === "number" ? value : Number(String(value).trim());
        return Number.isFinite(numeric) && numeric >= 0 && numeric < 1e12;
      },
      {
        message:
          "Deal value must be a non-negative number below 1,000,000,000,000",
      },
    )
    .describe("Numeric deal value"),
  // Must be persistable: without it, a user's typed-over value would be
  // silently overwritten by the next offer save.
  estimatedValueSource: z
    .enum(["OFFER", "MANUAL"])
    .nullable()
    .optional()
    .describe("Whether the deal value follows the offer or was typed"),
  probabilityOverride: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("Likelihood override 0-100; null inherits the stage default"),
  // nullableDateInput, not z.iso.datetime() — the latter rejects the
  // date-only strings a <input type="date"> emits.
  expectedCloseDate: nullableDateInput
    .describe("Expected close date")
    .optional(),
  estimatedStartDate: nullableDateInput
    .describe("Estimated build start date")
    .optional(),
} as const;

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1).optional(),

  phone: nullableTrimmedString.optional(),
  // #110: required-when-present on update — a lead's email cannot be cleared.
  email: requiredLeadEmail.optional(),
  location: nullableTrimmedString.optional(),

  secondaryName: nullableTrimmedString.optional(),
  secondaryEmail: nullableTrimmedString.optional(),
  secondaryPhone: nullableTrimmedString.optional(),

  source: nullableTrimmedString.optional(),
  sourceDetail: nullableTrimmedString.optional(),

  assignedId: nullableTrimmedString.optional(),
  budget: nullableTrimmedString.optional(),

  notes: nullableTrimmedString.optional(),
  notesDoc: leadRichTextDocumentSchema.nullable().optional(),
  annotationsToCreate: z.array(leadNoteAnnotationInputSchema).optional(),

  meetingDate: nullableDateInput.describe("Meeting date").optional(),
  meetingTime: nullableTrimmedString.optional(),
  meetingMode: nullableTrimmedString.optional(),

  followupReminderSentAt: z.iso.datetime().optional(),
  meetingReminderSentAt: z.iso.datetime().optional(),

  followupDate: nullableDateInput.describe("Follow-up date").optional(),

  followupTime: nullableTrimmedString.optional(),
  followupNotes: nullableTrimmedString.optional(),

  followupResponseOutcome: z
    .enum(["yes", "reschedule", "notRequired"])
    .optional(),

  meetingReviewOutcome: z.enum(["yes", "no"]).optional(),
  discussionNotes: nullableTrimmedString.optional(),
  buildScope: nullableTrimmedString.optional(),

  lostReason: nullableTrimmedString.optional(),

  urgent: z.boolean().optional(),

  stage: z.enum(leadStages).optional(),

  type: typeSchema.optional(),

  history: z.array(historyItemSchema).optional(),

  ...dealEconomicsFields,
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Lead name is required"),

  phone: nullableTrimmedString.optional(),
  // #110: every client email is mandatory — required + valid at creation.
  email: requiredLeadEmail,
  location: nullableTrimmedString.optional(),

  secondaryName: nullableTrimmedString.optional(),
  secondaryEmail: nullableTrimmedString.optional(),
  secondaryPhone: nullableTrimmedString.optional(),

  source: z.enum(leadSources).nullable().optional(),

  sourceDetail: nullableTrimmedString.optional(),

  assignedId: nullableTrimmedString.optional(),

  budget: nullableTrimmedString.optional(),

  type: typeArraySchema.optional(),

  notes: nullableTrimmedString.optional(),

  meetingDate: nullableDateInput.describe("Meeting date").optional(),
  meetingTime: nullableTrimmedString.optional(),
  meetingMode: nullableTrimmedString.optional(),

  followupReminderSentAt: z.iso.datetime().optional(),
  meetingReminderSentAt: z.iso.datetime().optional(),

  followupDate: nullableDateInput.describe("Follow-up date").optional(),

  followupTime: nullableTrimmedString.optional(),

  followupNotes: nullableTrimmedString.optional(),

  lostReason: nullableTrimmedString.optional(),

  urgent: z.boolean().optional().default(false),

  // Was a hand-duplicated copy of `leadStages`, with no `satisfies` guard, so
  // it drifted silently: removing a stage from the shared list left this one
  // still accepting it and POST /api/leads kept writing rows the UI could not
  // render. updateLeadSchema already used the shared list; now both do.
  stage: z.enum(leadStages).optional(),

  history: z.array(historySchema).optional(),

  ...dealEconomicsFields,
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const leadParamSchema = z.object({
  leadId: z.string().trim().min(1, "Lead ID is required"),
});

export type LeadParam = z.infer<typeof leadParamSchema>;

export const leadLookupParamSchema = z.object({
  sort: z.enum(LEAD_LIST_SORT_VALUES).optional(),
  ...paginationSchema.shape,
  q: z.string().trim().default(""),
  status: z.string().optional(),
  filterTiming: z.string().optional(),
  filterLeadsWithoutProject: z.string().optional(),
  isArchived: z.string().optional(),
  hasOpenTask: z.string().optional(),
  pendingFollowUps: z.string().optional(),
  upcomingFollowUps: z.string().optional(),
  pendingMeetings: z.string().optional(),
  upcomingMeetings: z.string().optional(),
});

export const leadStatusSchema = z.enum(leadStages);
