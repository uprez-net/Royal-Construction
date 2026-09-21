import { z } from "zod";
import { jsonValueSchema } from "@/agent/lib/result-contracts";

export const offerIdSchema = z.string().uuid();

export const searchOffersInputSchema = z.object({
  query: z.string().trim().min(2).max(120),
  limit: z.number().int().min(1).max(10).default(5),
});

export const getOfferInputSchema = z.object({
  offerId: offerIdSchema,
});

const workspacePatchKeys = [
  "job",
  "costLines",
  "allowances",
  "exclusions",
  "draft",
  "areaCalculator",
  "pricingSettings",
  "paymentSchedule",
  "rateCardProduct",
  "rateCardTier",
  "overrideReason",
  "priceAdjustmentLabel",
  "selectedPriceCents",
  "standardPriceCents",
  "images",
  "tenderGate",
  "adminContentVersion",
  "calcVersion",
] as const;

export const getOfferDetailsInputSchema = z.object({
  offerId: offerIdSchema,
});

export const updateOfferDetailsInputSchema = z.object({
  offerId: offerIdSchema,
  expectedStateVersion: z.number().int().nonnegative(),
  patch: z
    .record(z.string().min(1).max(80), jsonValueSchema)
    .refine(
      (value) =>
        Object.keys(value).every((key) =>
          (workspacePatchKeys as readonly string[]).includes(key),
        ),
      {
        message: "Patch contains an unsupported offer workspace section.",
      },
    )
    .refine((value) => JSON.stringify(value).length <= 250_000, {
      message: "Offer workspace patch is too large.",
    }),
});

export const listOfferRevisionsInputSchema = z.object({
  leadId: z.number().int().positive(),
  limit: z.number().int().min(1).max(25).default(10),
});

export const offerStatusSchema = z.enum([
  "SENT",
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "AGREED",
  "TENDER_DRAFT",
  "TENDER_SENT",
  "TENDER_SIGNED",
  "CONTRACT_DRAFT",
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "PROJECT",
  "SUPERSEDED",
  "TENDER_DECLINED",
  "CONTRACT_DECLINED",
  "OFFER_SENT",
  "OFFER_SIGNED",
  "OFFER_DECLINED",
]);

export const transitionOfferStatusInputSchema = z.object({
  offerId: offerIdSchema,
  toStatus: offerStatusSchema,
  note: z.string().trim().max(500).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
});

export const recallOfferEnvelopeInputSchema = z.object({
  offerId: offerIdSchema,
  scope: z.enum(["offer", "tender", "contract"]),
  toStatus: offerStatusSchema,
  note: z.string().trim().max(500).optional(),
});

export const createOfferRevisionInputSchema = z.object({
  offerId: offerIdSchema,
});

const contractParticularKeys = [
  "ownerAddress",
  "ownerPhone",
  "ownerMobile",
  "commencementDate",
  "constructionDays",
  "hbcfCost",
  "interestRate",
  "paymentDays",
  "preContractCosts",
  "lendingAuthority",
  "fundingOwner",
  "demolitionMaterials",
  "specialConditions",
] as const;

export const saveContractParticularsInputSchema = z.object({
  offerId: offerIdSchema,
  particulars: z.object(
    Object.fromEntries(
      contractParticularKeys.map((key) => [key, z.string().trim().max(10_000)]),
    ) as Record<(typeof contractParticularKeys)[number], z.ZodString>,
  ),
  manualOverrides: z
    .array(z.enum(contractParticularKeys))
    .max(contractParticularKeys.length),
});

export const logOfferChangeRequestInputSchema = z.object({
  leadId: z.number().int().positive(),
  note: z.string().trim().min(1).max(2_000),
});

const boundedStringArray = z.array(z.string().trim().max(500)).max(100);
export const checkOfferListsInputSchema = z.object({
  leadId: z.number().int().positive(),
  estimated: boundedStringArray,
  scheduled: boundedStringArray,
  excluded: boundedStringArray,
  offered: boundedStringArray,
});

export const draftOfferHighlightsInputSchema = z.object({
  leadId: z.number().int().positive(),
  scheduled: boundedStringArray,
});

export const pollOfferSigningStatusInputSchema = z.object({
  offerId: offerIdSchema,
});
