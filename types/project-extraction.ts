import { z } from "zod";

type FieldSection = {
  key:
    | "projectOverview"
    | "legalAdministration"
    | "commercialsAndClaims"
    | "subStructureAndGround"
    | "shellAndExternal"
    | "mechanicalDetails"
    | "internalFitOutAndFinishes"
    | "exclusionsAndRisks"
    | "utilityInfrastructure"
    | "wetAreaCompliance"
    | "safetyAndSiteLogistics";
  title: string;
  fields: readonly string[];
};

function toBlankString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (typeof entry === "number" || typeof entry === "boolean") {
        return [String(entry)];
      }

      return [] as string[];
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const blankStringField = z.preprocess(toBlankString, z.string().default(""));
const nullableNumberField = z.preprocess(toNullableNumber, z.number().nullable().default(null));
const stringArrayField = z.preprocess(toStringArray, z.array(z.string()).default([]));

export const projectExtractionSections: FieldSection[] = [
  {
    key: "projectOverview",
    title: "Project Overview",
    fields: ["projectName", "projectType", "summary"] as const,
  },
  {
    key: "legalAdministration",
    title: "Legal and Administration",
    fields: [
      "legalAdministrationSiteAddress",
      "legalAdministrationOwnerNames",
      "legalAdministrationOwnerEmails",
      "legalAdministrationOwnerPhones",
      "legalAdministrationCommencementTrigger",
      "legalAdministrationSignedDate",
      "legalAdministrationPcaInspector",
    ] as const,
  },
  {
    key: "commercialsAndClaims",
    title: "Commercials and Claims",
    fields: [
      "commercialsAndClaimsTotalContractSum",
      "commercialsAndClaimsTenderTotalPrice",
      "commercialsAndClaimsContractPrice",
      "commercialsAndClaimsGstIncluded",
      "commercialsAndClaimsGstAmount",
      "commercialsAndClaimsDepositValue",
      "commercialsAndClaimsClaimStageSlabPercentage",
      "commercialsAndClaimsClaimStageSlabDollarValue",
      "commercialsAndClaimsVariationAdminFee",
      "commercialsAndClaimsLatePenaltyRate",
      "commercialsAndClaimsPaymentStages",
    ] as const,
  },
  {
    key: "subStructureAndGround",
    title: "Sub Structure and Ground",
    fields: [
      "subStructureAndGroundConcreteSlabClass",
      "subStructureAndGroundConcreteStrengthMpa",
      "subStructureAndGroundVapourBarrier",
      "subStructureAndGroundTermiteSystem",
      "subStructureAndGroundSewerConnection",
    ] as const,
  },
  {
    key: "shellAndExternal",
    title: "Shell and External",
    fields: [
      "shellAndExternalCeilingHeightGroundFloor",
      "shellAndExternalCeilingHeightFirstFloor",
      "shellAndExternalRoofingMaterial",
      "shellAndExternalBrickAllowance",
      "shellAndExternalBrickCount",
      "shellAndExternalSelectedBrickPrice",
      "shellAndExternalWindowProvider",
      "shellAndExternalFloorAreaM2",
    ] as const,
  },
  {
    key: "mechanicalDetails",
    title: "Mechanical Details",
    fields: [
      "mechanicalDetailsAcSystemZones",
      "mechanicalDetailsAcRequiredCapacityKw",
      "mechanicalDetailsAcInstalledCapacityKw",
      "mechanicalDetailsLightingCount",
      "mechanicalDetailsTenderLightingCount",
      "mechanicalDetailsPowerPointCount",
      "mechanicalDetailsExternalPower",
      "mechanicalDetailsJointSealants",
    ] as const,
  },
  {
    key: "internalFitOutAndFinishes",
    title: "Internal Fit Out and Finishes",
    fields: [
      "internalFitOutAndFinishesInternalDoorHeight",
      "internalFitOutAndFinishesSkirtingSize",
      "internalFitOutAndFinishesStoneThickness",
      "internalFitOutAndFinishesWaterfallEnds",
      "internalFitOutAndFinishesTapwareFinish",
      "internalFitOutAndFinishesTilesProvisionRate",
      "internalFitOutAndFinishesTileAllowance",
      "internalFitOutAndFinishesSelectedTilePrice",
      "internalFitOutAndFinishesWetAreaSizeM2",
    ] as const,
  },
  {
    key: "exclusionsAndRisks",
    title: "Exclusions and Risks",
    fields: [
      "exclusionsAndRisksRetainingWalls",
      "exclusionsAndRisksFencing",
      "exclusionsAndRisksBlinds",
      "exclusionsAndRisksSolarProvisions",
      "exclusionsAndRisksRockExcavation",
      "exclusionsAndRisksOwnerResponsibility",
      "exclusionsAndRisksVariationRequired",
    ] as const,
  },
  {
    key: "utilityInfrastructure",
    title: "Utility Infrastructure",
    fields: [
      "utilityInfrastructureElectricalPhase",
      "utilityInfrastructureCommunicationConduit",
      "utilityInfrastructureGasConnection",
      "utilityInfrastructureFridgeWaterPoint",
      "utilityInfrastructureSmartLockBrand",
    ] as const,
  },
  {
    key: "wetAreaCompliance",
    title: "Wet Area Compliance",
    fields: [
      "wetAreaComplianceWaterproofingStandard",
      "wetAreaComplianceShowerScreenType",
      "wetAreaComplianceTiledNicheCount",
      "wetAreaComplianceShowerCount",
      "wetAreaComplianceFloorToCeilingTiles",
      "wetAreaComplianceFloorWasteType",
    ] as const,
  },
  {
    key: "safetyAndSiteLogistics",
    title: "Safety and Site Logistics",
    fields: [
      "safetyAndSiteLogisticsRoofGuardrails",
      "safetyAndSiteLogisticsSedimentControl",
      "safetyAndSiteLogisticsScaffoldingSafety",
      "safetyAndSiteLogisticsTradeWaste",
      "safetyAndSiteLogisticsFinalCleanStatus",
    ] as const,
  },
] as const;

export const projectExtractionSchema = z.object({
  projectName: blankStringField,
  projectType: blankStringField,
  summary: blankStringField,
  legalAdministrationSiteAddress: blankStringField,
  legalAdministrationOwnerNames: stringArrayField,
  legalAdministrationOwnerEmails: stringArrayField,
  legalAdministrationOwnerPhones: stringArrayField,
  legalAdministrationCommencementTrigger: blankStringField,
  legalAdministrationSignedDate: blankStringField,
  legalAdministrationPcaInspector: blankStringField,
  commercialsAndClaimsTotalContractSum: nullableNumberField,
  commercialsAndClaimsTenderTotalPrice: nullableNumberField,
  commercialsAndClaimsContractPrice: nullableNumberField,
  commercialsAndClaimsGstIncluded: z.preprocess(
    (value) => (typeof value === "boolean" ? value : null),
    z.boolean().nullable().default(null),
  ),
  commercialsAndClaimsGstAmount: nullableNumberField,
  commercialsAndClaimsDepositValue: nullableNumberField,
  commercialsAndClaimsClaimStageSlabPercentage: nullableNumberField,
  commercialsAndClaimsClaimStageSlabDollarValue: nullableNumberField,
  commercialsAndClaimsVariationAdminFee: nullableNumberField,
  commercialsAndClaimsLatePenaltyRate: nullableNumberField,
  commercialsAndClaimsPaymentStages: stringArrayField,
  subStructureAndGroundConcreteSlabClass: blankStringField,
  subStructureAndGroundConcreteStrengthMpa: nullableNumberField,
  subStructureAndGroundVapourBarrier: blankStringField,
  subStructureAndGroundTermiteSystem: blankStringField,
  subStructureAndGroundSewerConnection: blankStringField,
  shellAndExternalCeilingHeightGroundFloor: blankStringField,
  shellAndExternalCeilingHeightFirstFloor: blankStringField,
  shellAndExternalRoofingMaterial: blankStringField,
  shellAndExternalBrickAllowance: nullableNumberField,
  shellAndExternalBrickCount: nullableNumberField,
  shellAndExternalSelectedBrickPrice: nullableNumberField,
  shellAndExternalWindowProvider: blankStringField,
  shellAndExternalFloorAreaM2: nullableNumberField,
  mechanicalDetailsAcSystemZones: blankStringField,
  mechanicalDetailsAcRequiredCapacityKw: nullableNumberField,
  mechanicalDetailsAcInstalledCapacityKw: nullableNumberField,
  mechanicalDetailsLightingCount: nullableNumberField,
  mechanicalDetailsTenderLightingCount: nullableNumberField,
  mechanicalDetailsPowerPointCount: nullableNumberField,
  mechanicalDetailsExternalPower: blankStringField,
  mechanicalDetailsJointSealants: blankStringField,
  internalFitOutAndFinishesInternalDoorHeight: blankStringField,
  internalFitOutAndFinishesSkirtingSize: blankStringField,
  internalFitOutAndFinishesStoneThickness: blankStringField,
  internalFitOutAndFinishesWaterfallEnds: blankStringField,
  internalFitOutAndFinishesTapwareFinish: blankStringField,
  internalFitOutAndFinishesTilesProvisionRate: blankStringField,
  internalFitOutAndFinishesTileAllowance: nullableNumberField,
  internalFitOutAndFinishesSelectedTilePrice: nullableNumberField,
  internalFitOutAndFinishesWetAreaSizeM2: nullableNumberField,
  exclusionsAndRisksRetainingWalls: blankStringField,
  exclusionsAndRisksFencing: blankStringField,
  exclusionsAndRisksBlinds: blankStringField,
  exclusionsAndRisksSolarProvisions: blankStringField,
  exclusionsAndRisksRockExcavation: blankStringField,
  exclusionsAndRisksOwnerResponsibility: stringArrayField,
  exclusionsAndRisksVariationRequired: stringArrayField,
  utilityInfrastructureElectricalPhase: blankStringField,
  utilityInfrastructureCommunicationConduit: blankStringField,
  utilityInfrastructureGasConnection: blankStringField,
  utilityInfrastructureFridgeWaterPoint: blankStringField,
  utilityInfrastructureSmartLockBrand: blankStringField,
  wetAreaComplianceWaterproofingStandard: blankStringField,
  wetAreaComplianceShowerScreenType: blankStringField,
  wetAreaComplianceTiledNicheCount: nullableNumberField,
  wetAreaComplianceShowerCount: nullableNumberField,
  wetAreaComplianceFloorToCeilingTiles: blankStringField,
  wetAreaComplianceFloorWasteType: blankStringField,
  safetyAndSiteLogisticsRoofGuardrails: blankStringField,
  safetyAndSiteLogisticsSedimentControl: blankStringField,
  safetyAndSiteLogisticsScaffoldingSafety: blankStringField,
  safetyAndSiteLogisticsTradeWaste: blankStringField,
  safetyAndSiteLogisticsFinalCleanStatus: blankStringField,
}).strip();

export type ProjectExtractionData = z.infer<typeof projectExtractionSchema>;
export type ProjectExtractionSectionKey = FieldSection["key"];

export function createEmptyProjectExtractionData(): ProjectExtractionData {
  return projectExtractionSchema.parse({});
}

export function countAutoFilledExtractionFields(data: ProjectExtractionData) {
  return Object.values(data).filter((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === "number") {
      return Number.isFinite(value);
    }

    return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
  }).length;
}
