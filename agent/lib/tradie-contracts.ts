import { IncidentSeverity, TradiePriceUnit, TradieScheduleStatus } from "@prisma/client";
import { z } from "zod";

export const tradieIdSchema = z.string().uuid();
export const scheduleIdSchema = z.string().uuid();

const emailList = z.array(z.email().trim().toLowerCase()).max(10).default([]);

export const searchTradiesInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  trade: z.string().trim().max(120).optional(),
  favouriteOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
});

export const getTradieInputSchema = z.object({ tradieId: tradieIdSchema });

export const createTradieInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trade: z.string().trim().min(1).max(120),
  abn: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(80),
  email: z.email().trim().toLowerCase(),
  additionalEmails: emailList,
  location: z.string().trim().max(300).optional(),
  note: z.string().trim().max(4_000).optional(),
  lastQuotedPrice: z.number().finite().nonnegative().optional(),
  lastQuotedPriceUnit: z.enum(TradiePriceUnit).default(TradiePriceUnit.HOURLY),
});

export const updateTradieInputSchema = z.object({
  tradieId: tradieIdSchema,
  patch: z.object({
    email: z.email().trim().toLowerCase().optional(),
    additionalEmails: emailList.optional(),
    phone: z.string().trim().min(1).max(80).optional(),
    location: z.string().trim().max(300).nullable().optional(),
    note: z.string().trim().max(4_000).nullable().optional(),
    isFavourite: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0, { message: "At least one tradie field is required." }),
});

export const requestTradiePriceChangeInputSchema = z.object({
  tradieId: tradieIdSchema,
  amount: z.number().finite().nonnegative(),
  unit: z.enum(TradiePriceUnit).default(TradiePriceUnit.HOURLY),
  reason: z.string().trim().min(1).max(2_000),
});

export const requestTradieRemovalInputSchema = z.object({
  tradieId: tradieIdSchema,
  reason: z.string().trim().min(1).max(2_000),
});

export const reportTradieIncidentInputSchema = z.object({
  tradieId: tradieIdSchema,
  incidentType: z.string().trim().min(1).max(120),
  severity: z.enum(IncidentSeverity),
  description: z.string().trim().min(1).max(10_000),
  fileIds: z.array(z.string().uuid()).max(20).default([]),
});

export const rateTradieInputSchema = z.object({
  tradieId: tradieIdSchema,
  rating: z.number().finite().min(0.5).max(5),
  comment: z.string().trim().max(2_000).optional(),
});

const dateTime = z.iso.datetime({ offset: true });

export const listTradieSchedulesInputSchema = z.object({
  tradieId: tradieIdSchema.optional(),
  projectId: z.string().uuid().optional(),
  status: z.enum(TradieScheduleStatus).optional(),
  query: z.string().trim().max(120).default(""),
  from: dateTime.optional(),
  to: dateTime.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const createTradieScheduleInputSchema = z.object({
  tradieId: tradieIdSchema,
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  scheduledDate: dateTime,
  durationDays: z.number().int().min(1).max(365).default(1),
  requiresQuote: z.boolean().default(false),
});

export const transitionTradieScheduleInputSchema = z.object({
  scheduleId: scheduleIdSchema,
  toStatus: z.enum(TradieScheduleStatus),
  quote: z.string().trim().max(500).optional(),
  quoteUnit: z.enum(["FIXED", "HOURLY", "DAILY"]).optional(),
});

export const rescheduleTradieInputSchema = z.object({
  scheduleId: scheduleIdSchema,
  scheduledDate: dateTime,
  durationDays: z.number().int().min(1).max(365).optional(),
  milestoneId: z.string().uuid().nullable().optional(),
});

export const requestScheduleDeletionInputSchema = z.object({
  scheduleId: scheduleIdSchema,
  reason: z.string().trim().min(1).max(2_000),
});
