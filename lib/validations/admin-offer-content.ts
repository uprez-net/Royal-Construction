import { z } from "zod";

// Mirrors types/admin-offer-content.ts exactly. Used by server actions
// (validate before writing) and by the data layer (validate what comes
// back out of Json columns before trusting the cast).

export const buildScopeSchema = z.array(z.string());

const costScheduleRowBaseSchema = z.object({
  id: z.string().min(1),
  taskKey: z.string().min(1),
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
  // Accept any string key so old DB content with retired rate-constant keys
  // (e.g. SLAB_RATE_PER_SQM) doesn't fail parsing and wipe the entire cost
  // schedule. Unknown keys are filtered out in the application layer.
  rateConstants: z.record(z.string(), z.number()),
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

export const exclusionKindSchema = z.enum(["excluded", "owner_supplied"]);

export const offerExclusionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  variationRule: z.string(),
  exclusionKind: exclusionKindSchema,
});

export const offerScopeDataSchema = z.object({
  allowances: z.array(offerAllowanceSchema),
  exclusions: z.array(offerExclusionSchema),
});

export const hbfcClaimDataSchema = z.object({
  claimAmount: z.number(),
  loadingChargePercent: z.number(),
  totalPremiumToBePaid: z.number(),
});

export const inclusionScheduleRowSchema = z.object({
  spec: z.string(),
  category: z.string().optional(),
});

export const offerContentDataSchema = z.object({
  headline: z.string(),
  introText: z.string(),
  inclusions: z.array(z.string()),
  inclusionSchedule: z.array(inclusionScheduleRowSchema),
  exclusions: z.array(z.string()),
  termsAndConditions: z.string(),
});

export const adminOfferContentSchema = z.object({
  buildScope: buildScopeSchema,
  costSchedule: costScheduleDataSchema,
  offerScope: offerScopeDataSchema,
  offerContent: offerContentDataSchema,
});