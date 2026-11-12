import { z } from "zod";

const nullableNumberSchema = z.number().nullable();

/**
 * A string field that tolerates whatever the extraction agent hands back: a
 * blank string when the value is not printed on the document, `null` when it
 * was never captured, and a number/boolean when the model ignores the type.
 */
const blankTolerantStringSchema = z.preprocess((value) => {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value;
}, z.string().nullable());

/**
 * Reference to a document a section was populated from. `hbcfInsurance` is the
 * certificate uploaded from the Legal & Administration section; the tender and
 * contract references live on the payload's `sourceDocuments` bundle instead.
 */
const sourceDocumentReferenceSchema = z.object({
  fileId: z.string().default(""),
  fileName: z.string().default(""),
  url: z.string().default(""),
  kind: z.enum(["tender", "contract", "hbcfInsurance"]),
});

const conflictSchema = z.object({
  fieldPath: z.string().min(1),
  tenderValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  contractValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  resolvedValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  resolution: z.enum([
    "contract-wins",
    "tender-wins",
    "written-dimensions-win",
    "manual-review",
  ]),
  note: z.string().optional(),
});

/** One payment stage, as extracted and as stored on `Project.requirements`. */
export const paymentStageSchema = z.object({
  label: z.string().min(1),
  percentage: nullableNumberSchema,
  amount: nullableNumberSchema,
});

const projectExtractionDraftSchema = z.object({
  projectName: z.string().default(""),
  projectType: z.string().default(""),
  summary: z.string().default(""),
  legalAdministration: z.object({
    siteAddress: z.string().nullable(),
    ownerContacts: z.object({
      names: z.array(z.string()).default([]),
      emails: z.array(z.string()).default([]),
      phones: z.array(z.string()).default([]),
    }),
    commencementTrigger: z.string().nullable(),
    signedDate: z.string().nullable(),
    pcaInspector: z.string().nullable(),
    // Captured by the Slab-stage kickoff prompt rather than by extraction, so
    // it is optional: no payload written before that feature carries it.
    insuranceClaimStartDate: z.string().nullable().optional(),
    insuranceClaimEndDate: z.string().nullable().optional(),
    // Captured by the HBCF certificate upload in the Overview tab rather than
    // by tender/contract extraction, so both are optional: no payload written
    // before that feature carries them.
    hbcfInsuranceNumber: blankTolerantStringSchema.optional(),
    hbcfInsuranceDocument: sourceDocumentReferenceSchema.nullable().optional(),
    // Issue #423: several HBCF claim documents, each with its own amount.
    // Optional for the same reason as the two fields above.
    hbcfClaimDocuments: z
      .array(
        z.object({
          fileId: z.string().min(1),
          fileName: z.string().default(""),
          url: z.string().default(""),
          claimAmount: z.number().finite().nonnegative().nullable(),
          amountConfirmed: z.boolean().default(false),
          certificateNumber: z.string().nullable().default(null),
          coverStartDate: z.string().nullable().default(null),
        }),
      )
      .max(50)
      .optional(),
  }),
  commercialsAndClaims: z.object({
    totalContractSum: nullableNumberSchema,
    gstIncluded: z.boolean().nullable(),
    gstAmount: nullableNumberSchema,
    depositValue: nullableNumberSchema,
    claimStageSlabPercentage: nullableNumberSchema,
    claimStageSlabDollarValue: nullableNumberSchema,
    variationAdminFee: nullableNumberSchema,
    latePenaltyRate: nullableNumberSchema,
    paymentStages: z.array(paymentStageSchema).default([]),
  }),
  subStructureAndGround: z.object({
    concreteSlabClass: z.string().nullable(),
    concreteStrengthMpa: nullableNumberSchema,
    vapourBarrier: z.string().nullable(),
    termiteSystem: z.string().nullable(),
    sewerConnection: z.string().nullable(),
  }),
  shellAndExternal: z
    .object({
      ceilingHeightGroundFloor: z.string().nullable(),
      ceilingHeightFirstFloor: z.string().nullable(),
      roofingMaterial: z.string().nullable(),
      brickAllowance: nullableNumberSchema,
      brickCount: nullableNumberSchema,
      selectedBrickPrice: nullableNumberSchema,
      windowProvider: z.string().nullable(),
      floorAreaM2: nullableNumberSchema,
    })
    .optional(),
  mechanicalDetails: z
    .object({
      acSystemZones: z.string().nullable(),
      acRequiredCapacityKw: nullableNumberSchema,
      acInstalledCapacityKw: nullableNumberSchema,
      lightingCount: nullableNumberSchema,
      tenderLightingCount: nullableNumberSchema,
      powerPointCount: nullableNumberSchema,
      externalPower: z.string().nullable(),
      jointSealants: z.string().nullable(),
    })
    .optional(),
  internalFitOutAndFinishes: z
    .object({
      internalDoorHeight: z.string().nullable(),
      skirtingSize: z.string().nullable(),
      stoneThickness: z.string().nullable(),
      waterfallEnds: z.string().nullable(),
      tapwareFinish: z.string().nullable(),
      tilesProvisionRate: z.string().nullable(),
      tileAllowance: nullableNumberSchema,
      selectedTilePrice: nullableNumberSchema,
      wetAreaSizeM2: nullableNumberSchema,
    })
    .optional(),
  exclusionsAndRisks: z
    .object({
      retainingWalls: z.string().nullable(),
      fencing: z.string().nullable(),
      blinds: z.string().nullable(),
      solarProvisions: z.string().nullable(),
      rockExcavation: z.string().nullable(),
      ownerResponsibility: z.array(z.string()).default([]),
      variationRequired: z.array(z.string()).default([]),
    })
    .optional(),
  inclusionsAndExclusions: z.object({
    inclusions: z.array(z.string()).default([]),
    exclusions: z.array(z.string()).default([]),
  }),
  utilityInfrastructure: z.object({
    electricalPhase: z.string().nullable(),
    communicationConduit: z.string().nullable(),
    gasConnection: z.string().nullable(),
    fridgeWaterPoint: z.string().nullable(),
    smartLockBrand: z.string().nullable(),
  }),
  wetAreaCompliance: z.object({
    waterproofingStandard: z.string().nullable(),
    showerScreenType: z.string().nullable(),
    tiledNicheCount: nullableNumberSchema,
    showerCount: nullableNumberSchema,
    floorToCeilingTiles: z.string().nullable(),
    floorWasteType: z.string().nullable(),
  }),
  safetyAndSiteLogistics: z.object({
    roofGuardrails: z.string().nullable(),
    sedimentControl: z.string().nullable(),
    scaffoldingSafety: z.string().nullable(),
    tradeWaste: z.string().nullable(),
    finalCleanStatus: z.string().nullable(),
  }),
  conflicts: z.array(conflictSchema).default([]),
  automationTriggers: z.object({
    orderReminders: z.boolean().default(true),
    rainDelayCalculations: z.boolean().default(true),
    noticeCountdowns: z.boolean().default(true),
  }),
});

export type ProjectExtractionDraftInput = z.infer<
  typeof projectExtractionDraftSchema
>;

export function validateProjectExtractionDraft(input: unknown) {
  return projectExtractionDraftSchema.parse(input);
}

export const projectExtractionSchema = projectExtractionDraftSchema;
