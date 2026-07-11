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
  projectName: blankStringField.describe(
    "Project/job name or reference exactly as printed on the Tender/Contract cover page or header.",
  ),
  projectType: blankStringField.describe(
    "Build type (e.g. new build, knockdown-rebuild, renovation) if explicitly stated on the cover page or header.",
  ),
  summary: blankStringField.describe(
    "Faithful high-level summary of only what is explicitly stated; never editorialize or infer scope.",
  ),
  legalAdministrationSiteAddress: blankStringField.describe(
    "Contract 'WHERE' section: the string between 'SITE ADDRESS:' and 'FINANCE'. Prevents mobilization to the wrong lot.",
  ),
  legalAdministrationOwnerNames: stringArrayField.describe(
    "Contract 'WHO' section: each named owner (Owner 1, Owner 2, ...) as a separate entry.",
  ),
  legalAdministrationOwnerEmails: stringArrayField.describe(
    "Contract 'WHO' section: each owner's email address as a separate entry.",
  ),
  legalAdministrationOwnerPhones: stringArrayField.describe(
    "Contract 'WHO' section: each owner's mobile/phone number as a separate entry.",
  ),
  legalAdministrationCommencementTrigger: blankStringField.describe(
    "Contract Clause 10(a): the 'later of' condition plus list items (i) to (v) that start the build clock.",
  ),
  legalAdministrationSignedDate: blankStringField.describe(
    "Contract Page iii signature block: day, month, and year the contract was signed. Establishes 'Day 0'.",
  ),
  legalAdministrationPcaInspector: blankStringField.describe(
    "Contract Clause 1(e): the named Principal Certifying Authority responsible for statutory inspections.",
  ),
  commercialsAndClaimsTotalContractSum: nullableNumberField.describe(
    "Contract Page ii Price: the total contract sum. The master figure for all payment tracking.",
  ),
  commercialsAndClaimsTenderTotalPrice: nullableNumberField.describe(
    "Tender pricing summary total price, recorded as-is for reconciliation against the Contract price (should match; a mismatch is a red-alert discrepancy).",
  ),
  commercialsAndClaimsContractPrice: nullableNumberField.describe(
    "Contract Page ii Price: the signed contract price, the legal master value in any Tender-vs-Contract conflict.",
  ),
  commercialsAndClaimsGstIncluded: z.preprocess(
    (value) => (typeof value === "boolean" ? value : null),
    z.boolean().nullable().default(null),
  ).describe(
    "Contract Price section: whether the contract sum is explicitly marked inclusive of GST.",
  ),
  commercialsAndClaimsGstAmount: nullableNumberField.describe(
    "Contract Price section: the stated GST dollar component, only if explicitly shown.",
  ),
  commercialsAndClaimsDepositValue: nullableNumberField.describe(
    "Contract Schedule 2, 4(b) (cross-check Tender Sec 4): the deposit amount. NSW caps deposits at 10% of contract price.",
  ),
  commercialsAndClaimsClaimStageSlabPercentage: nullableNumberField.describe(
    "Contract Schedule 2, 4(a)(2): the slab claim stage percentage (e.g. 15%), triggers invoicing once slab is poured.",
  ),
  commercialsAndClaimsClaimStageSlabDollarValue: nullableNumberField.describe(
    "Contract Schedule 2, 4(a)(2): the slab claim stage dollar value, only if explicitly stated (do not calculate it).",
  ),
  commercialsAndClaimsVariationAdminFee: nullableNumberField.describe(
    "Tender Sec 4 (Variations): the stated $ variation admin fee (e.g. $250 + GST) applied to every owner change.",
  ),
  commercialsAndClaimsLatePenaltyRate: nullableNumberField.describe(
    "Contract Schedule 2, 3(a): the $ per calendar week late penalty rate.",
  ),
  commercialsAndClaimsPaymentStages: stringArrayField.describe(
    "Contract Schedule 2 payment schedule: each payment/claim stage as a separate entry, in document order. A complete schedule should sum to 100%.",
  ),
  subStructureAndGroundConcreteSlabClass: blankStringField.describe(
    "Tender 1.10 & 1.12: the stated slab class (e.g. H1 or M).",
  ),
  subStructureAndGroundConcreteStrengthMpa: nullableNumberField.describe(
    "Tender 1.12: the stated concrete strength in Mpa (e.g. 32Mpa).",
  ),
  subStructureAndGroundVapourBarrier: blankStringField.describe(
    "Tender 1.12: vapour barrier thickness in um (e.g. 300um). Expected whenever the slab class is H1/H2.",
  ),
  subStructureAndGroundTermiteSystem: blankStringField.describe(
    "Tender 2.3: the termite protection system (e.g. full perimeter + collar protection).",
  ),
  subStructureAndGroundSewerConnection: blankStringField.describe(
    "Tender 1.13: sewer connection to main, and its included/by-owner status.",
  ),
  shellAndExternalCeilingHeightGroundFloor: blankStringField.describe(
    "Tender 2.1: ceiling height in mm for the ground floor (e.g. 2700mm).",
  ),
  shellAndExternalCeilingHeightFirstFloor: blankStringField.describe(
    "Tender 2.1: ceiling height in mm for the first floor (e.g. 2700mm).",
  ),
  shellAndExternalRoofingMaterial: blankStringField.describe(
    "Tender 2.4: roofing material and insulation (e.g. Colorbond + Anticon blanket).",
  ),
  shellAndExternalBrickAllowance: nullableNumberField.describe(
    "Tender 2.5: the $ allowance per brick (e.g. $1.20), the baseline for any brick-selection variation.",
  ),
  shellAndExternalBrickCount: nullableNumberField.describe(
    "Total brick count, only if explicitly stated. Used with the brick price delta to size a variation.",
  ),
  shellAndExternalSelectedBrickPrice: nullableNumberField.describe(
    "Owner-selected brick price, only if explicitly documented in a selection or variation schedule.",
  ),
  shellAndExternalWindowProvider: blankStringField.describe(
    "Tender 2.2: the named window provider (e.g. Aluminium or ABM).",
  ),
  shellAndExternalFloorAreaM2: nullableNumberField.describe(
    "Total floor area in m², only if explicitly stated. Used to sanity-check AC capacity sizing.",
  ),
  mechanicalDetailsAcSystemZones: blankStringField.describe(
    "Tender 2.16: AC brand + kW + zone count (e.g. Daikin / 16kW / 4 zones).",
  ),
  mechanicalDetailsAcRequiredCapacityKw: nullableNumberField.describe(
    "Required AC capacity in kW, only if explicitly stated. Compared against installed capacity and floor area.",
  ),
  mechanicalDetailsAcInstalledCapacityKw: nullableNumberField.describe(
    "Tender 2.16: installed AC system capacity in kW (e.g. 16kW).",
  ),
  mechanicalDetailsLightingCount: nullableNumberField.describe(
    "Actual/as-built downlight count, only if explicitly stated. Compared against the tendered lighting count.",
  ),
  mechanicalDetailsTenderLightingCount: nullableNumberField.describe(
    "Tender 2.8: specified LED downlight count (e.g. 65). Extra fittings above this are a variation.",
  ),
  mechanicalDetailsPowerPointCount: nullableNumberField.describe(
    "Tender 2.8: specified double power point count (e.g. 35). Extra points above this are a variation.",
  ),
  mechanicalDetailsExternalPower: blankStringField.describe(
    "Tender 2.22: external power points scope, which signals a waterproofing requirement.",
  ),
  mechanicalDetailsJointSealants: blankStringField.describe(
    "Tender 2.5 / 2.11: waterproof/sealant references; must match the waterproofing certification.",
  ),
  internalFitOutAndFinishesInternalDoorHeight: blankStringField.describe(
    "Tender 2.10: internal door height in mm (e.g. 2340mm vs standard 2040mm).",
  ),
  internalFitOutAndFinishesSkirtingSize: blankStringField.describe(
    "Tender 2.10: skirting dimensions in mm x mm (e.g. 90mm x 18mm vs standard 67mm).",
  ),
  internalFitOutAndFinishesStoneThickness: blankStringField.describe(
    "Tender 2.14: benchtop stone thickness in mm for kitchen/pantry (e.g. 40mm vs standard 20mm).",
  ),
  internalFitOutAndFinishesWaterfallEnds: blankStringField.describe(
    "Tender 2.14: whether waterfall ends to the island are specified.",
  ),
  internalFitOutAndFinishesTapwareFinish: blankStringField.describe(
    "Tender 2.15: tapware finish (e.g. Chrome, Black, Gunmetal).",
  ),
  internalFitOutAndFinishesTilesProvisionRate: blankStringField.describe(
    "Tender 2.20: provisional tiling rate in $/m² (e.g. $30), the baseline for tiling overspend tracking.",
  ),
  internalFitOutAndFinishesTileAllowance: nullableNumberField.describe(
    "Total tile allowance value, only if explicitly stated in a provisional sum schedule.",
  ),
  internalFitOutAndFinishesSelectedTilePrice: nullableNumberField.describe(
    "Owner-selected tile price, only if explicitly documented. Compared against the provision rate for overspend.",
  ),
  internalFitOutAndFinishesWetAreaSizeM2: nullableNumberField.describe(
    "Total wet area in m², only if explicitly stated. Used with tile price delta to size a tiling variation.",
  ),
  exclusionsAndRisksRetainingWalls: blankStringField.describe(
    "Tender Exclusions & Notes: retaining wall inclusion/exclusion status.",
  ),
  exclusionsAndRisksFencing: blankStringField.describe(
    "Tender 2.23: fencing status (e.g. Not Included).",
  ),
  exclusionsAndRisksBlinds: blankStringField.describe(
    "Tender 2.25: blinds status (e.g. Not Included).",
  ),
  exclusionsAndRisksSolarProvisions: blankStringField.describe(
    "Tender 2.27: solar provisions status (e.g. Not Included).",
  ),
  exclusionsAndRisksRockExcavation: blankStringField.describe(
    "Tender Exclusions & Notes: rock excavation references, flagged as a variation item if present.",
  ),
  exclusionsAndRisksOwnerResponsibility: stringArrayField.describe(
    "Tender Exclusions & Notes: items explicitly marked as owner responsibility, one entry per item.",
  ),
  exclusionsAndRisksVariationRequired: stringArrayField.describe(
    "Tender Exclusions & Notes / Sec 4: items explicitly flagged as requiring a variation, one entry per item.",
  ),
  utilityInfrastructureElectricalPhase: blankStringField.describe(
    "Tender 1.14: electrical phase (e.g. Three Phase), needed to support high-capacity AC systems.",
  ),
  utilityInfrastructureCommunicationConduit: blankStringField.describe(
    "Tender 1.14: comms conduit provider references (e.g. Telstra or NBN).",
  ),
  utilityInfrastructureGasConnection: blankStringField.describe(
    "Tender 2.7: gas hot water system (Gas HWS) references.",
  ),
  utilityInfrastructureFridgeWaterPoint: blankStringField.describe(
    "Tender 2.7: cold water outlet for fridge, if stated.",
  ),
  utilityInfrastructureSmartLockBrand: blankStringField.describe(
    "Tender 2.12: named smart lock brand (e.g. Philips).",
  ),
  wetAreaComplianceWaterproofingStandard: blankStringField.describe(
    "Tender 2.11: waterproofing compliance standard (e.g. AS3740 or BCA). Mandatory for Occupation Certificate.",
  ),
  wetAreaComplianceShowerScreenType: blankStringField.describe(
    "Tender 2.17: shower screen type (e.g. semi-frameless).",
  ),
  wetAreaComplianceTiledNicheCount: nullableNumberField.describe(
    "Tender 2.17: tiled niche count. Should match the number of showers identified.",
  ),
  wetAreaComplianceShowerCount: nullableNumberField.describe(
    "Total shower count, only if explicitly stated. Used to confirm a tiled niche exists per shower.",
  ),
  wetAreaComplianceFloorToCeilingTiles: blankStringField.describe(
    "Tender 2.17: floor-to-ceiling tiling status.",
  ),
  wetAreaComplianceFloorWasteType: blankStringField.describe(
    "Tender 2.7 / 2.17: floor drainage/waste type (e.g. smart tile waste vs chrome grate).",
  ),
  safetyAndSiteLogisticsRoofGuardrails: blankStringField.describe(
    "Tender 3.3: roof guardrail / WorkCover status, required for roof work.",
  ),
  safetyAndSiteLogisticsSedimentControl: blankStringField.describe(
    "Tender 1.6 / 3.1: EPA/sediment control references; EPA fines can exceed $15k if silt leaves site.",
  ),
  safetyAndSiteLogisticsScaffoldingSafety: blankStringField.describe(
    "Tender 2.4: safety rails/scaffolding references, required for second-storey work.",
  ),
  safetyAndSiteLogisticsTradeWaste: blankStringField.describe(
    "Tender 3.1: waste receptacle references, prevents council fines for a messy street frontage.",
  ),
  safetyAndSiteLogisticsFinalCleanStatus: blankStringField.describe(
    "Tender 3.6: interior and exterior clean status, required for handover.",
  ),
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