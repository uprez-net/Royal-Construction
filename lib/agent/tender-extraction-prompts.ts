import type { ProjectExtractionSectionKey } from "@/types/project-extraction";

type TenderExtractionPromptInput = {
  tenderMarkdown: string;
  contractMarkdown: string;
  tenderFileName: string;
  contractFileName: string;
  leadInfo?: string;
};

const EXTRACTION_CONTRACT = `
extraction contract:
- Fill each schema field individually from the most specific source section available.
- Leave a field blank ("" / null / []) when the value is not explicitly present.
- Never fabricate, infer, or complete missing data from context.
- Never emit raw JSON, nested objects, or object-like strings for a field value.
- Prefer Tender for scope, inclusions, exclusions, pricing, and acceptance language.
- Prefer Contract for signed-date, MBA reference, payment timing, and any post-sign legal metadata.
- If the documents conflict, keep the most document-specific value and leave a short conflict note in the source reasoning, not in the field value.
`;

/**
 * Per-field extraction guidance sourced from the "Tender & Contract Mapping To
 * Project Details Page" specification. Each entry describes where the value
 * normally lives, the exact extraction logic a human reviewer would apply,
 * and why the field matters operationally. This is presentation-only
 * guidance for the model's reasoning -- it does not change the schema, the
 * output shape, or any parsing logic.
 */
type FieldGuide = {
  label: string;
  source: string;
  logic: string;
  importance: string;
};

type SectionGuide = {
  title: string;
  goal: string;
  fields: Partial<Record<string, FieldGuide>>;
};

const FIELD_GUIDE: Record<ProjectExtractionSectionKey, SectionGuide> = {
  projectOverview: {
    title: "Project Overview",
    goal: "Establish the high-level identity of the job from header/cover-page metadata.",
    fields: {
      projectName: {
        label: "Project Name",
        source: "Tender/Contract cover page or header",
        logic: "Extract the project or job name/reference exactly as printed.",
        importance: "Used to match the extraction back to the correct CRM lead/project record.",
      },
      projectType: {
        label: "Project Type",
        source: "Tender/Contract cover page or header",
        logic: "Extract build type (e.g. new build, knockdown-rebuild, renovation) if explicitly stated.",
        importance: "Drives which downstream checklist/workflow the project follows.",
      },
      summary: {
        label: "Summary",
        source: "Tender/Contract cover page",
        logic: "Only summarize content that is explicitly present; do not editorialize or infer scope.",
        importance: "Gives site staff a fast, faithful snapshot of the job.",
      },
    },
  },
  legalAdministration: {
    title: "Legal & Administration",
    goal: "Establish the who, where, and when to prevent legal delays.",
    fields: {
      legalAdministrationSiteAddress: {
        label: "Site Address",
        source: 'Contract: "WHERE" section',
        logic: "Extract the string between 'SITE ADDRESS:' and 'FINANCE'.",
        importance: "Prevents mobilization to the wrong lot.",
      },
      legalAdministrationOwnerNames: {
        label: "Owner Names",
        source: 'Contract: "WHO" > Owner(s)',
        logic: "Extract each named owner (Owner 1, Owner 2, ...) as separate array entries.",
        importance: "Confirms who is legally party to the contract.",
      },
      legalAdministrationOwnerEmails: {
        label: "Owner Emails",
        source: 'Contract: "WHO" > Owner(s)',
        logic: "Extract each owner's email address as a separate array entry.",
        importance: "Instant access for site-meeting requests and notices.",
      },
      legalAdministrationOwnerPhones: {
        label: "Owner Phones",
        source: 'Contract: "WHO" > Owner(s)',
        logic: "Extract each owner's mobile/phone number as a separate array entry.",
        importance: "Instant access for site-meeting requests and urgent contact.",
      },
      legalAdministrationCommencementTrigger: {
        label: "Commencement Trigger",
        source: "Contract: Clause 10(a)",
        logic: "Identify the 'later of' condition and the accompanying list items (i) to (v).",
        importance: "Tracks the stopwatch for official build start.",
      },
      legalAdministrationSignedDate: {
        label: "Signed Date",
        source: "Contract: Page iii (Signed Date)",
        logic: "Extract day, month, and year from the signature block.",
        importance: "Establishes the contractual 'Day 0' for the build period.",
      },
      legalAdministrationPcaInspector: {
        label: "PCA / Inspector",
        source: "Contract: Clause 1(e)",
        logic: "Search for the named Principal Certifying Authority.",
        importance: "Identifies who must be called for statutory inspections.",
      },
    },
  },
  commercialsAndClaims: {
    title: "Commercials & Claims",
    goal: "Automate financial tracking so no unpaid work or incorrect claim goes unnoticed.",
    fields: {
      commercialsAndClaimsTotalContractSum: {
        label: "Total Contract Sum",
        source: "Contract: Page ii (Price)",
        logic: "Extract the $ value and note whether it is inclusive of GST.",
        importance: "The single source of truth for all downstream payment tracking.",
      },
      commercialsAndClaimsTenderTotalPrice: {
        label: "Tender Total Price",
        source: "Tender: pricing summary",
        logic: "Extract the Tender's own total price figure for reconciliation against the Contract price.",
        importance: "Should equal the Contract price; a mismatch is a red-alert discrepancy.",
      },
      commercialsAndClaimsContractPrice: {
        label: "Contract Price",
        source: "Contract: Page ii (Price)",
        logic: "Extract the signed Contract price, the legal master figure.",
        importance: "Legal master value used to reconcile against the Tender total price.",
      },
      commercialsAndClaimsGstIncluded: {
        label: "GST Included",
        source: "Contract: Price section",
        logic: "Extract the boolean 'Inclusive of GST' checkbox/statement only if explicitly stated.",
        importance: "Confirms whether the contract sum already accounts for GST.",
      },
      commercialsAndClaimsGstAmount: {
        label: "GST Amount",
        source: "Contract: Price section",
        logic: "Extract the stated GST dollar component only if explicitly shown.",
        importance: "Should be consistent with Contract Price / 11; large mismatches indicate a documentation error.",
      },
      commercialsAndClaimsDepositValue: {
        label: "Deposit Value",
        source: "Contract: Schedule 2, 4(b); cross-check Tender Sec 4",
        logic: "Extract the stated deposit amount.",
        importance: "Ensures the mobilization fee is paid before start; NSW caps deposits at 10% of contract price.",
      },
      commercialsAndClaimsClaimStageSlabPercentage: {
        label: "Claim Stage: Slab %",
        source: "Contract: Schedule 2, 4(a)(2)",
        logic: "Extract the slab claim stage percentage (e.g. 15%).",
        importance: "Triggers the slab-stage invoice as soon as the slab is poured.",
      },
      commercialsAndClaimsClaimStageSlabDollarValue: {
        label: "Claim Stage: Slab $",
        source: "Contract: Schedule 2, 4(a)(2)",
        logic: "Extract the slab claim stage dollar value if stated explicitly (do not calculate it yourself).",
        importance: "Confirms the exact invoice amount for the slab claim stage.",
      },
      commercialsAndClaimsVariationAdminFee: {
        label: "Variation Admin Fee",
        source: "Tender: Sec 4 (Variations)",
        logic: "Search for the stated $ variation admin fee (e.g. $250 + GST).",
        importance: "Every owner change must add this fee automatically.",
      },
      commercialsAndClaimsLatePenaltyRate: {
        label: "Late Penalty Rate",
        source: "Contract: Schedule 2, 3(a)",
        logic: "Extract the $ per calendar week penalty rate.",
        importance: "Prevents 'time is of the essence' disputes over delay costs.",
      },
      commercialsAndClaimsPaymentStages: {
        label: "Payment Stages",
        source: "Contract: Schedule 2 payment schedule",
        logic: "Extract each payment/claim stage as a separate array entry, in document order.",
        importance: "The full staged schedule should sum to 100%; a sum of 95% or 105% is legally invalid.",
      },
    },
  },
  subStructureAndGround: {
    title: "Sub-Structure & Ground",
    goal: "Capture the specific engineering specs that prevent slab or drainage failure.",
    fields: {
      subStructureAndGroundConcreteSlabClass: {
        label: "Concrete Slab Class",
        source: "Tender: 1.10 & 1.12",
        logic: "Look for the stated slab class (e.g. H1 or M).",
        importance: "Wrong class leads to slab cracking and a costly variation.",
      },
      subStructureAndGroundConcreteStrengthMpa: {
        label: "Concrete Strength (MPa)",
        source: "Tender: 1.12",
        logic: "Look for the stated Mpa value (e.g. 32Mpa).",
        importance: "Engineering compliance requirement for heavy loads.",
      },
      subStructureAndGroundVapourBarrier: {
        label: "Vapour Barrier",
        source: "Tender: 1.12",
        logic: "Extract the stated thickness in micrometres (e.g. 300um).",
        importance: "Prevents rising damp; mandatory for H-class slabs.",
      },
      subStructureAndGroundTermiteSystem: {
        label: "Termite System",
        source: "Tender: 2.3",
        logic: "Identify the stated system (e.g. full perimeter + collar protection).",
        importance: "Critical for obtaining the Occupation Certificate.",
      },
      subStructureAndGroundSewerConnection: {
        label: "Sewer Connection",
        source: "Tender: 1.13",
        logic: "Search for 'sewer connection to main' and its included/by-owner status.",
        importance: "Clarifies whether the builder or owner is responsible for the connection.",
      },
    },
  },
  shellAndExternal: {
    title: "Shell & External",
    goal: "Capture the exterior materials to avoid wrong-color or wrong-product errors.",
    fields: {
      shellAndExternalCeilingHeightGroundFloor: {
        label: "Ceiling Height (Ground Floor)",
        source: "Tender: 2.1",
        logic: "Extract the stated mm value for the ground floor (e.g. 2700mm).",
        importance: "Critical for framing order accuracy.",
      },
      shellAndExternalCeilingHeightFirstFloor: {
        label: "Ceiling Height (First Floor)",
        source: "Tender: 2.1",
        logic: "Extract the stated mm value for the first floor (e.g. 2700mm).",
        importance: "Critical for head-clearance on stairs.",
      },
      shellAndExternalRoofingMaterial: {
        label: "Roofing Material",
        source: "Tender: 2.4",
        logic: "Identify the roofing material and insulation (e.g. Colorbond + Anticon blanket).",
        importance: "Prevents condensation/mold issues under the roof.",
      },
      shellAndExternalBrickAllowance: {
        label: "Brick Allowance ($/brick)",
        source: "Tender: 2.5",
        logic: "Extract the stated $ value per brick (e.g. $1.20).",
        importance: "Baseline used to track a variation if the owner selects a pricier brick.",
      },
      shellAndExternalBrickCount: {
        label: "Brick Count",
        source: "Tender: 2.5 or quantity schedule",
        logic: "Extract the total brick count only if explicitly stated.",
        importance: "Multiplied against any brick price delta to size a variation.",
      },
      shellAndExternalSelectedBrickPrice: {
        label: "Selected Brick Price",
        source: "Tender/Contract variation or selection schedule",
        logic: "Extract the owner-selected brick price only if explicitly documented.",
        importance: "Compared against the brick allowance to size any owner-selection variation.",
      },
      shellAndExternalWindowProvider: {
        label: "Window Provider",
        source: "Tender: 2.2",
        logic: "Identify the named provider (e.g. Aluminium or ABM).",
        importance: "Identifies who to call for broken glass or missing screens.",
      },
      shellAndExternalFloorAreaM2: {
        label: "Floor Area (m²)",
        source: "Tender/Contract site/floor schedule",
        logic: "Extract the total floor area in m² only if explicitly stated.",
        importance: "Used to sanity-check AC capacity sizing against total floor area.",
      },
    },
  },
  mechanicalDetails: {
    title: "Mechanical Details",
    goal: "Track tapes, zones, and high-tech specs precisely.",
    fields: {
      mechanicalDetailsAcSystemZones: {
        label: "AC System / Zones",
        source: "Tender: 2.16",
        logic: "Extract brand + kW + zone count (e.g. Daikin / 16kW / 4 zones).",
        importance: "Prevents an incorrect ducting layout.",
      },
      mechanicalDetailsAcRequiredCapacityKw: {
        label: "AC Required Capacity (kW)",
        source: "Tender: 2.16 or engineering schedule",
        logic: "Extract the required capacity only if explicitly stated.",
        importance: "Compared against installed capacity and floor area to flag underpowered systems.",
      },
      mechanicalDetailsAcInstalledCapacityKw: {
        label: "AC Installed Capacity (kW)",
        source: "Tender: 2.16",
        logic: "Extract the installed system capacity (e.g. 16kW).",
        importance: "Should be adequate for the total floor area; undersizing is a comfort/compliance risk.",
      },
      mechanicalDetailsLightingCount: {
        label: "Lighting Count (as-built)",
        source: "Electrical plan / as-built schedule",
        logic: "Extract the actual/counted downlight count only if explicitly stated.",
        importance: "Compared against the tendered lighting count to catch an under-billed variation.",
      },
      mechanicalDetailsTenderLightingCount: {
        label: "Tender Lighting Count",
        source: "Tender: 2.8",
        logic: "Search for 'LED downlights' and extract the specified integer (e.g. 65).",
        importance: "Baseline count; any extra fittings above this are a variation.",
      },
      mechanicalDetailsPowerPointCount: {
        label: "Power Point Count",
        source: "Tender: 2.8",
        logic: "Search for 'double power points' and extract the specified integer (e.g. 35).",
        importance: "Baseline count; extra points above this are a variation.",
      },
      mechanicalDetailsExternalPower: {
        label: "External Power",
        source: "Tender: 2.22",
        logic: "Search for 'external power points' and extract the stated scope.",
        importance: "Signals a waterproofing requirement for exterior wet locations.",
      },
      mechanicalDetailsJointSealants: {
        label: "Joint Sealants",
        source: "Tender: 2.5 / 2.11",
        logic: "Search for 'waterproof' / 'sealant' references.",
        importance: "The tape/glue type must match the waterproofing certification.",
      },
    },
  },
  internalFitOutAndFinishes: {
    title: "Internal Fit-Out & Finishes",
    goal: "Capture the finish-level details that most commonly trigger owner variations.",
    fields: {
      internalFitOutAndFinishesInternalDoorHeight: {
        label: "Internal Door Height",
        source: "Tender: 2.10",
        logic: "Extract the stated mm value (e.g. 2340mm).",
        importance: "Standard is 2040mm; 2340mm signals a high-spec upgrade with lead-time implications.",
      },
      internalFitOutAndFinishesSkirtingSize: {
        label: "Skirting Size",
        source: "Tender: 2.10",
        logic: "Extract the stated mm x mm dimensions (e.g. 90mm x 18mm).",
        importance: "Prevents substitution with cheaper standard 67mm skirting.",
      },
      internalFitOutAndFinishesStoneThickness: {
        label: "Stone Thickness",
        source: "Tender: 2.14",
        logic: "Extract the stated mm value for kitchen/pantry benchtops (e.g. 40mm).",
        importance: "Standard is 20mm; 40mm requires a different cabinet carcass.",
      },
      internalFitOutAndFinishesWaterfallEnds: {
        label: "Waterfall Ends",
        source: "Tender: 2.14",
        logic: "Identify whether waterfall ends to the island are specified.",
        importance: "High-cost item that is often missed during benchtop rough-in.",
      },
      internalFitOutAndFinishesTapwareFinish: {
        label: "Tapware Finish",
        source: "Tender: 2.15",
        logic: "Identify the stated finish (e.g. Chrome, Black, Gunmetal).",
        importance: "Getting the exact color wrong causes a costly re-order late in the build.",
      },
      internalFitOutAndFinishesTilesProvisionRate: {
        label: "Tiles Provision Rate ($/m²)",
        source: "Tender: 2.20",
        logic: "Extract the stated $/m² provisional tiling rate (e.g. $30).",
        importance: "Baseline used to track the owner's overspend if a pricier tile is chosen.",
      },
      internalFitOutAndFinishesTileAllowance: {
        label: "Tile Allowance",
        source: "Tender: 2.20 provisional sum schedule",
        logic: "Extract the total tile allowance value only if explicitly stated.",
        importance: "Used alongside the provision rate and wet area size to size any tile variation.",
      },
      internalFitOutAndFinishesSelectedTilePrice: {
        label: "Selected Tile Price",
        source: "Tender/Contract selection or variation schedule",
        logic: "Extract the owner-selected tile price only if explicitly documented.",
        importance: "Compared against the provision rate to calculate the owner's tiling overspend.",
      },
      internalFitOutAndFinishesWetAreaSizeM2: {
        label: "Wet Area Size (m²)",
        source: "Tender/Contract floor schedule",
        logic: "Extract the total wet area in m² only if explicitly stated.",
        importance: "Multiplied against the tile price delta to size the tiling variation.",
      },
    },
  },
  exclusionsAndRisks: {
    title: "Exclusions & Risks",
    goal: "Flag items the owner may assume are included but are explicitly excluded.",
    fields: {
      exclusionsAndRisksRetainingWalls: {
        label: "Excluded: Retaining Walls",
        source: "Tender: Exclusions & Notes",
        logic: "Search for 'retaining walls'; record the stated inclusion/exclusion status.",
        importance: "High soil-related risk if not clearly excluded up front.",
      },
      exclusionsAndRisksFencing: {
        label: "Excluded: Fencing",
        source: "Tender: 2.23",
        logic: "Record the stated status (e.g. Not Included).",
        importance: "Prevents a 'where is my fence?' dispute later in the build.",
      },
      exclusionsAndRisksBlinds: {
        label: "Excluded: Blinds",
        source: "Tender: 2.25",
        logic: "Record the stated status (e.g. Not Included).",
        importance: "Prevents confusion at handover/Occupation Certificate stage.",
      },
      exclusionsAndRisksSolarProvisions: {
        label: "Solar Provisions",
        source: "Tender: 2.27",
        logic: "Record the stated status (e.g. Not Included).",
        importance: "Avoids rough-in for solar that was never paid for.",
      },
      exclusionsAndRisksRockExcavation: {
        label: "Rock Excavation",
        source: "Tender: Exclusions & Notes",
        logic: "Search for 'rock' references and record whether it is flagged as a variation item.",
        importance: "Prevents the builder absorbing significant unbudgeted excavation costs.",
      },
      exclusionsAndRisksOwnerResponsibility: {
        label: "Owner Responsibility Items",
        source: "Tender: Exclusions & Notes",
        logic: "Extract each item explicitly marked as owner responsibility as a separate array entry.",
        importance: "Keeps owner-action items off the Site Manager's to-do list.",
      },
      exclusionsAndRisksVariationRequired: {
        label: "Variation Required Items",
        source: "Tender: Exclusions & Notes / Sec 4",
        logic: "Extract each item explicitly flagged as requiring a variation as a separate array entry.",
        importance: "Surfaces likely-cost items early rather than mid-build.",
      },
    },
  },
  utilityInfrastructure: {
    title: "Utility Infrastructure",
    goal: "Ensure the house actually functions: power, data, and gas.",
    fields: {
      utilityInfrastructureElectricalPhase: {
        label: "Electrical Phase",
        source: "Tender: 1.14",
        logic: "Search for 'phase' (e.g. Three Phase).",
        importance: "Three-phase power is essential to support high-capacity AC systems.",
      },
      utilityInfrastructureCommunicationConduit: {
        label: "Comms Conduit",
        source: "Tender: 1.14",
        logic: "Search for 'Telstra' or 'NBN' references.",
        importance: "Prevents having to dig up a finished driveway later.",
      },
      utilityInfrastructureGasConnection: {
        label: "Gas Connection",
        source: "Tender: 2.7",
        logic: "Search for 'Gas HWS' (hot water system) references.",
        importance: "Requires specific pipe sizing for continuous-flow systems.",
      },
      utilityInfrastructureFridgeWaterPoint: {
        label: "Fridge Water Point",
        source: "Tender: 2.7",
        logic: "Search for a stated cold-water outlet for the fridge.",
        importance: "If missed at rough-in stage, becomes a costly variation.",
      },
      utilityInfrastructureSmartLockBrand: {
        label: "Smart Lock Brand",
        source: "Tender: 2.12",
        logic: "Search for a named brand (e.g. Philips).",
        importance: "Determines the door prep/routing the carpenter must perform.",
      },
    },
  },
  wetAreaCompliance: {
    title: "Wet Area Compliance",
    goal: "Prevent the leading cause of structural failure and insurance claims: waterproofing defects.",
    fields: {
      wetAreaComplianceWaterproofingStandard: {
        label: "Waterproofing Standard",
        source: "Tender: 2.11",
        logic: "Search for 'AS3740' or 'BCA' references.",
        importance: "Mandatory compliance reference; missing it risks a rejected Occupation Certificate.",
      },
      wetAreaComplianceShowerScreenType: {
        label: "Shower Screen Type",
        source: "Tender: 2.17",
        logic: "Identify the stated type (e.g. semi-frameless).",
        importance: "Affects the required floor fall during screeding.",
      },
      wetAreaComplianceTiledNicheCount: {
        label: "Tiled Niche Count",
        source: "Tender: 2.17",
        logic: "Search for 'tiled niche' and extract the specified count.",
        importance: "Carpenter must box these out before plastering.",
      },
      wetAreaComplianceShowerCount: {
        label: "Shower Count",
        source: "Tender/Contract floor plan schedule",
        logic: "Extract the total shower count only if explicitly stated.",
        importance: "Used to confirm a tiled niche exists for every shower.",
      },
      wetAreaComplianceFloorToCeilingTiles: {
        label: "Floor to Ceiling Tiles",
        source: "Tender: 2.17",
        logic: "Identify the stated floor-to-ceiling tiling status.",
        importance: "Drives the total tile row count based on wall height.",
      },
      wetAreaComplianceFloorWasteType: {
        label: "Floor Waste Type",
        source: "Tender: 2.7 / 2.17",
        logic: "Search for 'drainage' or 'waste' references.",
        importance: "Distinguishes a smart-tile waste from a chrome grate.",
      },
    },
  },
  safetyAndSiteLogistics: {
    title: "Safety & Site Logistics",
    goal: "Keep the site legally compliant and avoid WorkCover/council fines.",
    fields: {
      safetyAndSiteLogisticsRoofGuardrails: {
        label: "Roof Guardrails",
        source: "Tender: 3.3",
        logic: "Search for 'roof guardrail' / 'Work Cover' references.",
        importance: "Required status for any roof work under WorkCover regulations.",
      },
      safetyAndSiteLogisticsSedimentControl: {
        label: "Sediment Control",
        source: "Tender: 1.6 / 3.1",
        logic: "Search for 'EPA' or 'sediment' references.",
        importance: "EPA fines of $15k+ can apply if silt leaves the site uncontrolled.",
      },
      safetyAndSiteLogisticsScaffoldingSafety: {
        label: "Scaffolding / Safety",
        source: "Tender: 2.4",
        logic: "Search for 'safety rails' references.",
        importance: "Required for second-storey bricklaying/cladding work.",
      },
      safetyAndSiteLogisticsTradeWaste: {
        label: "Trade Waste",
        source: "Tender: 3.1",
        logic: "Search for 'waste receptacle' references.",
        importance: "Prevents council fines for a messy street frontage.",
      },
      safetyAndSiteLogisticsFinalCleanStatus: {
        label: "Final Clean Status",
        source: "Tender: 3.6",
        logic: "Search for 'interior and exterior cleaned' references.",
        importance: "A professional clean is required as a condition of handover.",
      },
    },
  },
};

function renderSectionGuideXml() {
  return Object.entries(FIELD_GUIDE)
    .map(([key, section]) => {
      const fieldsXml = Object.entries(section.fields)
        .map(([fieldKey, guide]) => {
          if (!guide) return "";
          return `      <field name="${fieldKey}" label="${guide.label}">
        <source>${guide.source}</source>
        <logic>${guide.logic}</logic>
        <why_it_matters>${guide.importance}</why_it_matters>
      </field>`;
        })
        .join("\n");

      return `    <section key="${key}" title="${section.title}">
      <goal>${section.goal}</goal>
${fieldsXml}
    </section>`;
    })
    .join("\n");
}

export const TENDER_EXTRACTION_SYSTEM_PROMPT = `
<role>
You are a construction document extraction specialist for Royal Constructions. You read a Tender PDF and a signed Contract PDF, plus optional lead information, and populate a flat structured extraction object that matches the provided schema exactly.
</role>

<extraction_contract>
${EXTRACTION_CONTRACT}
</extraction_contract>

<general_rules>
  <rule>Return only structured output that matches the schema.</rule>
  <rule>Treat every field as independent. Do not bundle values into paragraphs, tables, arrays of objects, or nested JSON.</rule>
  <rule>Use empty string, null, or [] for any value that cannot be verified directly from the documents.</rule>

  <rule>Use Tender sections for scope, inclusions, exclusions, allowances, payment schedule, and acceptance language.</rule>
  <rule>Use Contract sections for signature date, contract administration metadata, and any MBA-specific reference information.</rule>
  <rule>Use Lead Information for any missing site, client, or contact details.</rule>
  <rule>If a field appears in both documents, prefer the signed Contract for post-signature administrative facts and the Tender for scope/legal package content.</rule>
  <rule>If a field is not found, leave it blank rather than fabricating something plausible.</rule>
</general_rules>

<precedence_and_conflict_resolution>
  <!-- Reasoning aids only: these help you choose the correct single value per field. They do not add output fields or change the schema. -->
  <rule name="contract_over_tender_price">If the Tender total price and Contract price disagree, the Contract price is the legal master for commercialsAndClaimsContractPrice/commercialsAndClaimsTotalContractSum; still record the Tender's own figure faithfully in commercialsAndClaimsTenderTotalPrice rather than overwriting it with the Contract value.</rule>
  <rule name="contract_overrides_tender_spec">Per Clause 4(a), where the Contract (including its Special Conditions) and the Tender specification conflict on scope or specification, the Contract value takes precedence for that field.</rule>
  <rule name="written_over_scaled">Where a written dimension (e.g. "2700mm") conflicts with a scaled drawing measurement, prefer the written dimension.</rule>
  <rule name="deposit_sanity">Deposit values are typically capped at 10% of the contract price under NSW rules; extract the figure as documented rather than recalculating it, but do not silently "correct" an implausible OCR read without re-checking the source text.</rule>
  <rule name="payment_stage_sum">A complete payment/claim stage schedule should sum to 100%; if the extracted stages look incomplete, re-check the source markdown for missed rows before finalizing commercialsAndClaimsPaymentStages.</rule>
  <rule name="h_class_vapour_barrier">An H1/H2 slab class normally requires a vapour barrier; if subStructureAndGroundConcreteSlabClass indicates an H-class slab but no vapour barrier text is found, double-check the source before leaving subStructureAndGroundVapourBarrier blank.</rule>
</precedence_and_conflict_resolution>

<section_guide>
${renderSectionGuideXml()}
</section_guide>

<anti_hallucination>
  <item>blank means blank</item>
  <item>null means unknown numeric or boolean-like value</item>
  <item>[] means no line items were found</item>
  <item>never stringify a JSON object into a field</item>
  <item>never average, calculate, or derive a value that is not explicitly printed in the source text, even where a formula is described above as background context</item>
</anti_hallucination>
`;

export function buildTenderExtractionPrompt(input: TenderExtractionPromptInput) {
  return `  
Extract the project information from the following source documents.
  
Tender file: ${input.tenderFileName}
Contract file: ${input.contractFileName}

  ${input.leadInfo ?
      `
  Lead information Markdown: 
  ${input.leadInfo}
  ` :
      ""}

Tender OCR markdown:
${input.tenderMarkdown}

Contract OCR markdown:
${input.contractMarkdown}

Populate every field you can verify. Leave the rest blank.
`;
}