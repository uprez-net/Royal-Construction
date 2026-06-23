import { z } from "zod";

import type { LeadSource, LeadStage } from "@/lib/leads/types";
import { paginationSchema } from "./common";

export const leadStages = [
  "New",
  "Contacted",
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
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
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

// const dateInputSchema = z.preprocess((value) => {
//   if (typeof value !== "string" || value.trim() === "") {
//     return null;
//   }

//   const parsed = new Date(value);

//   if (Number.isNaN(parsed.getTime())) {
//     return null;
//   }

//   return parsed;
// }, z.date().nullable());

const typeSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
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
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
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

export const updateLeadSchema = z.object({
  name: z.string().trim().min(1).optional(),

  phone: nullableTrimmedString.optional(),
  email: nullableTrimmedString.optional(),
  location: nullableTrimmedString.optional(),

  source: nullableTrimmedString.optional(),
  sourceDetail: nullableTrimmedString.optional(),

  assignedId: nullableTrimmedString.optional(),
  budget: nullableTrimmedString.optional(),

  notes: nullableTrimmedString.optional(),
  notesDoc: leadRichTextDocumentSchema.nullable().optional(),
  annotationsToCreate: z.array(leadNoteAnnotationInputSchema).optional(),

  followupDate: nullableDateInput.describe("Follow-up date").optional(),

  followupTime: nullableTrimmedString.optional(),
  followupNotes: nullableTrimmedString.optional(),

  lostReason: nullableTrimmedString.optional(),

  urgent: z.boolean().optional(),

  stage: z.enum(leadStages).optional(),

  type: typeSchema.optional(),

  history: z.array(historyItemSchema).optional(),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Lead name is required"),

  phone: nullableTrimmedString.optional(),
  email: nullableTrimmedString.optional(),
  location: nullableTrimmedString.optional(),

  source: z.enum(leadSources).nullable().optional(),

  sourceDetail: nullableTrimmedString.optional(),

  assignedId: nullableTrimmedString.optional(),

  budget: nullableTrimmedString.optional(),

  type: typeArraySchema.optional(),

  notes: nullableTrimmedString.optional(),

  followupDate: nullableDateInput.describe("Follow-up date").optional(),

  followupTime: nullableTrimmedString.optional(),

  followupNotes: nullableTrimmedString.optional(),

  lostReason: nullableTrimmedString.optional(),

  urgent: z.boolean().optional().default(false),

  stage: z
    .enum([
      "New",
      "Contacted",
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
    ])
    .optional(),

  history: z.array(historySchema).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const leadParamSchema = z.object({
  leadId: z.string().trim().min(1, "Lead ID is required"),
});

export type LeadParam = z.infer<typeof leadParamSchema>;

export const leadLookupParamSchema = z.object({
  ...paginationSchema.shape,
  q: z.string().trim().default(""),
  status: z.string().optional(),
  filterTiming: z.string().optional(),
})

export const leadStatusSchema = z.enum(leadStages);
