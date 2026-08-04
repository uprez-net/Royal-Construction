import { z } from "zod";

// Mirrors types/admin-offer-content.ts exactly. Used by server actions
// (validate before writing) and by the data layer (validate what comes
// back out of Json columns before trusting the cast).

export const buildScopeSchema = z.array(z.string());

const costScheduleRowBaseSchema = z.object({
  id: z.string().min(1),
  phase: z.string(),
  task: z.string(),
  mapId: z
    .number()
    .int()
    .nullish()
    .transform((v) => (v === null ? undefined : v)),
  defaultInclude: z.boolean(),
});

export const costScheduleRowSchema = z.discriminatedUnion("priceMode", [
  costScheduleRowBaseSchema.extend({
    priceMode: z.literal("none"),
  }),
  costScheduleRowBaseSchema.extend({
    priceMode: z.literal("fixed"),
    value: z.number(),
  }),
  costScheduleRowBaseSchema.extend({
    priceMode: z.literal("formula"),
    formula: z.string(),
  }),
]);

export const costScheduleDataSchema = z.object({
  rows: z.array(costScheduleRowSchema),
  formulaVariables: z.record(z.string(), z.number()),
});

export const allowanceCategorySchema = z.enum([
  "package",
  "per-sqm",
  "per-lm",
  "note-only",
]);

export const offerAllowanceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: allowanceCategorySchema,
  amount: z.number(),
  variationRule: z.string(),
});

export const offerExclusionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  variationRule: z.string(),
});

export const offerScopeDataSchema = z.object({
  allowances: z.array(offerAllowanceSchema),
  exclusions: z.array(offerExclusionSchema),
});

export const offerContentDataSchema = z.object({
  inclusions: z.array(z.string()),
  termsAndConditions: z.string(),
});

export const adminOfferContentSchema = z.object({
  buildScope: buildScopeSchema,
  costSchedule: costScheduleDataSchema,
  offerScope: offerScopeDataSchema,
  offerContent: offerContentDataSchema,
});
