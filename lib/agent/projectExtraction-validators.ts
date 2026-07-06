import { z } from "zod";

const nullableNumberSchema = z.number().nullable();

const conflictSchema = z.object({
  fieldPath: z.string().min(1),
  tenderValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  contractValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  resolvedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  resolution: z.enum(["contract-wins", "tender-wins", "written-dimensions-win", "manual-review"]),
  note: z.string().optional(),
});

const paymentStageSchema = z.object({
  label: z.string().min(1),
  percentage: nullableNumberSchema,
  amount: nullableNumberSchema,
});

const projectExtractionDraftSchema = z.object({
  projectName: z.string().default(""),
  projectType: z.string().default(""),
  summary: z.string().default(""),
  legalAdministration: z.object({
    siteAddress: z.string().default(""),
    ownerContacts: z.object({
      names: z.array(z.string()).default([]),
      emails: z.array(z.string()).default([]),
      phones: z.array(z.string()).default([]),
    }),
    commencementTrigger: z.string().default(""),
    signedDate: z.string().default(""),
    pcaInspector: z.string().default(""),
  }),
  commercialsAndClaims: z.object({
    totalContractSum: nullableNumberSchema,
    tenderTotalPrice: nullableNumberSchema,
    contractPrice: nullableNumberSchema,
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
    concreteSlabClass: z.string().default(""),
    concreteStrengthMpa: nullableNumberSchema,
    vapourBarrier: z.string().default(""),
    termiteSystem: z.string().default(""),
    sewerConnection: z.string().default(""),
  }),
  shellAndExternal: z.object({
    ceilingHeightGroundFloor: z.string().default(""),
    ceilingHeightFirstFloor: z.string().default(""),
    roofingMaterial: z.string().default(""),
    brickAllowance: nullableNumberSchema,
    brickCount: nullableNumberSchema,
    selectedBrickPrice: nullableNumberSchema,
    windowProvider: z.string().default(""),
    floorAreaM2: nullableNumberSchema,
  }),
  mechanicalDetails: z.object({
    acSystemZones: z.string().default(""),
    acRequiredCapacityKw: nullableNumberSchema,
    acInstalledCapacityKw: nullableNumberSchema,
    lightingCount: nullableNumberSchema,
    tenderLightingCount: nullableNumberSchema,
    powerPointCount: nullableNumberSchema,
    externalPower: z.string().default(""),
    jointSealants: z.string().default(""),
  }),
  internalFitOutAndFinishes: z.object({
    internalDoorHeight: z.string().default(""),
    skirtingSize: z.string().default(""),
    stoneThickness: z.string().default(""),
    waterfallEnds: z.string().default(""),
    tapwareFinish: z.string().default(""),
    tilesProvisionRate: z.string().default(""),
    tileAllowance: nullableNumberSchema,
    selectedTilePrice: nullableNumberSchema,
    wetAreaSizeM2: nullableNumberSchema,
  }),
  exclusionsAndRisks: z.object({
    retainingWalls: z.string().default(""),
    fencing: z.string().default(""),
    blinds: z.string().default(""),
    solarProvisions: z.string().default(""),
    rockExcavation: z.string().default(""),
    ownerResponsibility: z.array(z.string()).default([]),
    variationRequired: z.array(z.string()).default([]),
  }),
  utilityInfrastructure: z.object({
    electricalPhase: z.string().default(""),
    communicationConduit: z.string().default(""),
    gasConnection: z.string().default(""),
    fridgeWaterPoint: z.string().default(""),
    smartLockBrand: z.string().default(""),
  }),
  wetAreaCompliance: z.object({
    waterproofingStandard: z.string().default(""),
    showerScreenType: z.string().default(""),
    tiledNicheCount: nullableNumberSchema,
    showerCount: nullableNumberSchema,
    floorToCeilingTiles: z.string().default(""),
    floorWasteType: z.string().default(""),
  }),
  safetyAndSiteLogistics: z.object({
    roofGuardrails: z.string().default(""),
    sedimentControl: z.string().default(""),
    scaffoldingSafety: z.string().default(""),
    tradeWaste: z.string().default(""),
    finalCleanStatus: z.string().default(""),
  }),
  conflicts: z.array(conflictSchema).default([]),
  automationTriggers: z.object({
    orderReminders: z.boolean().default(true),
    rainDelayCalculations: z.boolean().default(true),
    noticeCountdowns: z.boolean().default(true),
  }),
});

export type ProjectExtractionDraftInput = z.infer<typeof projectExtractionDraftSchema>;

export function validateProjectExtractionDraft(input: unknown) {
  return projectExtractionDraftSchema.parse(input);
}

export const projectExtractionSchema = projectExtractionDraftSchema;
