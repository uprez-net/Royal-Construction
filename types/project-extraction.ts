import { z } from "zod";

type FieldSection = {
  key:
    | "projectOverview"
    | "legalAdministration"
    | "commercialsAndClaims"
    | "subStructureAndGround"
    | "inclusionsAndExclusions"
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
    // Number("") is 0, which would turn a blank input into a real zero.
    if (value.trim() === "") {
      return null;
    }

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
const nullableNumberField = z.preprocess(
  toNullableNumber,
  z.number().nullable().default(null),
);
const stringArrayField = z.preprocess(
  toStringArray,
  z.array(z.string()).default([]),
);

/**
 * Keeps the entries that are objects. Deliberately does NOT trim or drop blank
 * rows: the review form re-parses this schema on every keystroke, so trimming
 * here would eat the space between a first and last name as it is typed, and
 * dropping blanks would delete the empty row the operator just added. The
 * domain owner rule (`lib/domain/projects/owners.ts`) trims and ignores blank
 * rows when the project is created.
 */
function toOwnerRows(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as unknown[];
  }

  return value.filter(
    (entry) =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

// One record per owner. This replaced three independent lists (names, emails,
// phones) that were paired by index, so an owner with no email on the
// contract shifted every later owner's email onto the wrong person. Every
// field is required before the project is created (lib/domain/projects/
// owners.ts); blank here only means "not found in the documents".
const ownerField = z.object({
  name: blankStringField.describe(
    "The owner's full name, or the company name for a company owner, exactly as printed.",
  ),
  email: blankStringField.describe(
    "This owner's own email address, only if printed against this owner. Blank otherwise.",
  ),
  phone: blankStringField.describe(
    "This owner's own mobile or phone number, only if printed against this owner. Blank otherwise.",
  ),
  address: blankStringField.describe(
    "This owner's own residential or postal address (the 'of ...' line against the owner, or a company's registered office), NOT the site address. Blank if not printed.",
  ),
});

const ownersField = z.preprocess(toOwnerRows, z.array(ownerField).default([]));

export type ProjectExtractionOwner = z.infer<typeof ownerField>;

export const projectExtractionSections: FieldSection[] = [
  {
    key: "projectOverview",
    title: "Project Overview",
    fields: ["projectName", "projectType", "lotSize", "summary"] as const,
  },
  {
    key: "legalAdministration",
    title: "Legal and Administration",
    fields: [
      "legalAdministrationSiteAddress",
      "legalAdministrationOwners",
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
    key: "inclusionsAndExclusions",
    title: "Inclusions and Exclusions",
    fields: [
      "inclusionsAndExclusionsInclusions",
      "inclusionsAndExclusionsExclusions",
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

export const projectExtractionSchema = z
  .object({
    projectName: blankStringField.describe(
      "Project/job name or reference exactly as printed on the Tender/Contract cover page or header.",
    ),
    projectType: blankStringField.describe(
      "Build type (e.g. new build, knockdown-rebuild, renovation) if explicitly stated on the cover page or header.",
    ),
    // Coerced like every other numeric field: the review step re-parses this
    // schema on every keystroke, so it has to accept the string an <input> hands
    // back. Non-negativity is checked on submit instead (handleSubmit in
    // create-project-modal.tsx; nonNegativeSchema on the POST /api/projects route).
    lotSize: nullableNumberField.describe(
      "Lot size in square metres, only if explicitly stated. Used to confirm the build is within the correct lot boundaries.",
    ),
    summary: blankStringField.describe(
      "Faithful high-level summary of only what is explicitly stated; never editorialize or infer scope.",
    ),
    legalAdministrationSiteAddress: blankStringField.describe(
      "Contract 'WHERE' section: the string between 'SITE ADDRESS:' and 'FINANCE'. Prevents mobilization to the wrong lot.",
    ),
    legalAdministrationOwners: ownersField.describe(
      "Contract 'WHO' section: one entry per named owner (Owner 1, Owner 2, ...), in document order, each with that owner's own name, email and phone. Never move a contact detail onto a different owner; leave it blank when it is not printed against this owner.",
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
    commercialsAndClaimsGstIncluded: z
      .preprocess(
        (value) => (typeof value === "boolean" ? value : null),
        z.boolean().nullable().default(null),
      )
      .describe(
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
    inclusionsAndExclusionsInclusions: stringArrayField.describe(
      "Tender inclusions: each item explicitly listed as included in the tender/contract scope, one entry per item.",
    ),
    inclusionsAndExclusionsExclusions: stringArrayField.describe(
      "Tender exclusions: each item explicitly listed as excluded from the tender/contract scope, one entry per item.",
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
  })
  .strip();

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

    return typeof value === "string"
      ? value.trim().length > 0
      : value !== null && value !== undefined;
  }).length;
}
