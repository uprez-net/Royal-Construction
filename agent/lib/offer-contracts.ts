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

/**
 * Which client document an exclusion change is for.
 *
 * The two lists reach different documents: the client's Offer document prints
 * only `draft.exclusionBullets`, and the Scope `exclusions` feed the Tender's
 * exclusion schedule only, whatever their `includedInOfferDocument` flag says.
 * On staging, "add an exclusion" with no document named was written to the
 * Tender list without anyone choosing that, so a change that touches either
 * list has to say which document the user asked for, and must touch only that
 * document's list. It is also shown on the approval card.
 */
export const exclusionDocumentSchema = z.enum(["offer", "tender", "both"]);

export const updateOfferDetailsInputSchema = z
  .object({
    offerId: offerIdSchema,
    expectedStateVersion: z.number().int().nonnegative(),
    exclusionDocument: exclusionDocumentSchema.optional(),
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
  })
  .superRefine((input, ctx) => {
    const tender = "exclusions" in input.patch;
    const draft = input.patch.draft;
    const offer =
      typeof draft === "object"
      && draft !== null
      && !Array.isArray(draft)
      && "exclusionBullets" in draft;
    if (!tender && !offer) return;

    if (!input.exclusionDocument) {
      ctx.addIssue({
        code: "custom",
        message:
          'Say which document this exclusion change is for: "offer" (the client\'s Offer document, draft.exclusionBullets) or "tender" (the Tender schedule, exclusions). If the user did not say, ask them rather than choosing.',
        path: ["exclusionDocument"],
      });
      return;
    }
    if (input.exclusionDocument === "offer" && tender) {
      ctx.addIssue({
        code: "custom",
        message:
          "An Offer document exclusion is a line in draft.exclusionBullets; the Scope `exclusions` list only reaches the Tender.",
        path: ["patch", "exclusions"],
      });
    }
    if (input.exclusionDocument === "tender" && offer) {
      ctx.addIssue({
        code: "custom",
        message:
          "A Tender exclusion goes in the Scope `exclusions` list; draft.exclusionBullets only reaches the client's Offer document.",
        path: ["patch", "draft", "exclusionBullets"],
      });
    }
    if (input.exclusionDocument === "both" && !(tender && offer)) {
      ctx.addIssue({
        code: "custom",
        message:
          "An exclusion for both documents changes both draft.exclusionBullets and the Scope `exclusions` list.",
        path: ["patch"],
      });
    }
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

export const startOfferInputSchema = z.object({
  leadId: z.number().int().positive(),
  // The workspace fills a new offer's Job setup from the lead in the browser;
  // this is the same model call, opted out of when the user says not to.
  prefillFromLead: z.boolean().default(true),
});

export const emailOfferProposalInputSchema = z.object({
  offerId: offerIdSchema,
});

/** The three documents that go out for DocuSign signature, in lifecycle order. */
export const signatureDocumentSchema = z.enum(["offer", "tender", "contract"]);

export const sendOfferForSignatureInputSchema = z.object({
  offerId: offerIdSchema,
  document: signatureDocumentSchema,
});

export const createProjectFromOfferInputSchema = z.object({
  offerId: offerIdSchema,
});
