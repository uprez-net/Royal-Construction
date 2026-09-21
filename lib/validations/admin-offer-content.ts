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

// Write path only. The read schema above still accepts a blank rule so that
// coerceOfferScope can load the live admin row (prod and staging stored one
// on "Ground floor ceiling upgrade"). A failed parse keeps valid rows and
// drops invalid ones, so tightening the read schema would hide that
// allowance instead of showing the blank. A save must not re-commit it onto
// every new offer and signed Tender.
export const offerAllowanceWriteSchema = offerAllowanceSchema.extend({
  variationRule: z
    .string()
    .trim()
    .min(1, "Every allowance needs a variation rule."),
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

export const offerScopeWriteSchema = offerScopeDataSchema.extend({
  allowances: z.array(offerAllowanceWriteSchema),
});

export const hbcfClaimDataSchema = z.object({
  // Neither is ever negative: claimAmount is the whole-book HBCF sum assured
  // and loadingChargePercent a premium loading. The admin inputs refuse a minus
  // sign, but the action is a server action anyone signed in as an admin can
  // call directly, and the writer persists whatever parses.
  claimAmount: z.number().nonnegative(),
  loadingChargePercent: z.number().nonnegative(),
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
