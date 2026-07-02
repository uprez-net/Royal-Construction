import type {
  LegacyWorkbookPricingSettings,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";
import {
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingByTask,
  type OfferSequenceMapping,
} from "@/lib/offer/workspace-sequence-mapping";

export const OFFER_STAGE_CATALOG = [
  { code: "A", name: "General Requirements" },
  { code: "B", name: "Site Preparation" },
  { code: "C", name: "Footings & Slab" },
  { code: "D", name: "Frame & Roof" },
  { code: "E", name: "External Envelope" },
  { code: "F", name: "Plumbing" },
  { code: "G", name: "Electrical" },
  { code: "H", name: "HVAC" },
  { code: "I", name: "Internal Linings" },
  { code: "J", name: "Waterproofing & Tiling" },
  { code: "K", name: "Kitchen, Bath & Joinery" },
  { code: "L", name: "PC Items & Fixtures" },
  { code: "M", name: "Painting" },
  { code: "N", name: "External Works" },
  { code: "O", name: "Completion & Handover" },
] as const;

export type OfferStageCode = (typeof OFFER_STAGE_CATALOG)[number]["code"];

export type OfferWorkspaceJob = {
  readonly reference: string;
  readonly revision: string;
  readonly clientNames: string;
  readonly clientEmail: string;
  readonly clientPhone: string;
  readonly siteAddress: string;
  readonly buildType: string;
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly garageSqm: number;
  readonly alfrescoPorchSqm: number;
  readonly porchSqm: number;
  readonly grannyFlatSqm: number;
  readonly validUntil: string;
  readonly preparedBy: string;
};

export type OfferWorkspaceCostLine = {
  readonly id: string;
  readonly stageCode: OfferStageCode;
  readonly itemName: string;
  readonly buildingSequenceTasks: readonly string[];
  readonly offerTenderLineItem: string;
  readonly tradeOrVendor: string;
  readonly notesOrSpec: string;
  readonly costExGst: number;
  readonly includedInContract: boolean;
  readonly sourceReference?: string;
};

export type OfferWorkspaceScopeItem = {
  readonly id: string;
  readonly category: OfferScopeItemCategory;
  readonly amountType: OfferScopeAmountType;
  readonly label: string;
  readonly description: string;
  readonly amount: number;
  readonly unit: string;
  readonly variationRule: string;
  readonly includedInOfferDocument: boolean;
};

export type OfferScopeItemCategory =
  | "prime_cost"
  | "provisional_sum"
  | "owner_selection"
  | "exclusion"
  | "other";

export type OfferScopeAmountType =
  | "fixed_amount"
  | "rate_per_sqm"
  | "included_note";

export type OfferDocumentDraft = {
  readonly headline: string;
  readonly introText: string;
  readonly inclusionBullets: readonly string[];
  readonly exclusionBullets: readonly string[];
  readonly termsSummary: string;
};

// Full Offer lifecycle across the Offer → Tender → Contract phases, ending in
// the Project handoff. See CONTEXT.md ("Offer status") and ADR 0001.
export type OfferWorkspaceStatus =
  | "pending"
  | "sent"
  | "agreed"
  | "tender_draft"
  | "tender_sent"
  | "tender_signed"
  | "contract_draft"
  | "contract_sent"
  | "contract_signed"
  | "project"
  | "rejected"
  | "superseded";

// Human-readable badge copy for each status.
export const OFFER_STATUS_LABEL: Record<OfferWorkspaceStatus, string> = {
  pending: "Pending",
  sent: "Sent",
  agreed: "Agreed",
  tender_draft: "Tender draft",
  tender_sent: "Tender sent",
  tender_signed: "Tender signed",
  contract_draft: "Contract draft",
  contract_sent: "Contract sent",
  contract_signed: "Contract signed",
  project: "Project",
  rejected: "Rejected",
  superseded: "Superseded",
};

export const DEFAULT_WORKSPACE_PRICING_SETTINGS: OfferWorkspacePricingSettings = {
  targetMarkupPct: 0.2,
  minimumMarkupPct: 0.15,
  gstRate: 0.1,
  hbcfRate: 0.013,
  adminCostFixed: 5000,
  projectManagementCostFixed: 10000,
  contingencyPct: 0.025,
};

export const DEFAULT_LEGACY_PRICING_SETTINGS: LegacyWorkbookPricingSettings = {
  overheadPct: 0.1,
  royalConstructionFeePct: 0.2,
  hbcfInsuranceFixed: 0,
  adminCostFixed: 5000,
  labourCostFixed: 0,
  otherAdjustmentFixed: 0,
};

export const INITIAL_OFFER_JOB: OfferWorkspaceJob = {
  reference: "RC-Q-2026-001",
  revision: "R1",
  clientNames: "Mr Mahesh & Ms Anisha",
  clientEmail: "client@example.com",
  clientPhone: "0400 000 000",
  siteAddress: "13 Binalong Road, Pendle Hill NSW 2145",
  buildType: "Custom Double Storey Residence",
  groundFloorSqm: 138,
  firstFloorSqm: 126,
  garageSqm: 36,
  alfrescoPorchSqm: 24,
  porchSqm: 8,
  grannyFlatSqm: 0,
  validUntil: "2026-07-30",
  preparedBy: "Gurpinder Uppal - Director, Royal Constructions",
};

const INITIAL_COST_BY_TASK = new Map<string, number>([
  ["GENERAL REQUIREMENTS", 28500],
  ["SLAB", 84500],
  ["FRAME", 132000],
  ["KITCHEN", 76000],
]);

export const INITIAL_COST_LINES: readonly OfferWorkspaceCostLine[] =
  OFFER_SEQUENCE_MAPPINGS.map((mapping, index) =>
    createCostLineFromSequenceMapping(mapping, index),
  );

function createCostLineFromSequenceMapping(
  mapping: OfferSequenceMapping,
  index: number,
): OfferWorkspaceCostLine {
  const costExGst = INITIAL_COST_BY_TASK.get(mapping.taskName) ?? 0;

  return {
    id: `task-${index + 1}-${slugifyTaskName(mapping.taskName)}`,
    stageCode: inferOfferStageCode(mapping.taskName),
    itemName: mapping.taskName,
    buildingSequenceTasks: mapping.buildingSequenceTasks,
    offerTenderLineItem: mapping.offerTenderWording,
    tradeOrVendor: mapping.tradesToBook.join(", "),
    notesOrSpec: mapping.offerTenderWording,
    costExGst,
    includedInContract: costExGst > 0,
  };
}

export const INITIAL_ALLOWANCES: readonly OfferWorkspaceScopeItem[] = [
  {
    id: "allowance-1",
    category: "prime_cost",
    amountType: "fixed_amount",
    label: "Kitchen appliances",
    description: "Prime cost allowance for oven, cooktop and rangehood.",
    amount: 8500,
    unit: "package",
    variationRule: "Selections above allowance become a variation.",
    includedInOfferDocument: true,
  },
  {
    id: "allowance-2",
    category: "prime_cost",
    amountType: "rate_per_sqm",
    label: "Tiles and bathroom fixtures",
    description: "Selection allowance for wet-area tiles and tapware.",
    amount: 70,
    unit: "sqm",
    variationRule: "Tile selections above the rate are priced as a variation.",
    includedInOfferDocument: true,
  },
];

export const INITIAL_EXCLUSIONS: readonly OfferWorkspaceScopeItem[] = [
  {
    id: "exclusion-1",
    category: "exclusion",
    amountType: "included_note",
    label: "Pool, spa and water features",
    description: "Can be priced later as a variation or separate package.",
    amount: 0,
    unit: "",
    variationRule: "Can be priced later as a written variation.",
    includedInOfferDocument: true,
  },
  {
    id: "exclusion-2",
    category: "owner_selection",
    amountType: "included_note",
    label: "Window furnishings and loose furniture",
    description: "Owner selection outside the fixed-price building scope.",
    amount: 0,
    unit: "",
    variationRule: "Owner-supplied unless added by written variation.",
    includedInOfferDocument: true,
  },
];

export const INITIAL_OFFER_DRAFT: OfferDocumentDraft = {
  headline: "Fixed price building offer",
  introText:
    "Royal Constructions is pleased to provide this fixed price offer based on the current plans, selections and assumptions captured in the calculation workbook.",
  inclusionBullets: [
    "New custom dwelling construction based on the current drawing set",
    "Standard approvals, engineering, HBCF, site preparation and core building works",
    "Kitchen, bathroom and fixture allowances captured as prime cost items",
  ],
  exclusionBullets: [],
  termsSummary:
    "Final Tender is issued only after scope and price are agreed by builder and client.",
};

export function updateOfferScopeItems(
  items: readonly OfferWorkspaceScopeItem[],
  itemId: string,
  patch: Partial<OfferWorkspaceScopeItem>,
): readonly OfferWorkspaceScopeItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
}

export function applyTaskMappingToCostLine(
  line: OfferWorkspaceCostLine,
  taskName: string,
): OfferWorkspaceCostLine {
  const mapping = getOfferSequenceMappingByTask(taskName);

  if (mapping === null) {
    return {
      ...line,
      itemName: taskName,
      buildingSequenceTasks: [],
      offerTenderLineItem: "",
      tradeOrVendor: "",
      notesOrSpec: "",
      stageCode: inferOfferStageCode(taskName),
    };
  }

  return {
    ...line,
    itemName: mapping.taskName,
    buildingSequenceTasks: mapping.buildingSequenceTasks,
    offerTenderLineItem: mapping.offerTenderWording,
    tradeOrVendor: mapping.tradesToBook.join(", "),
    notesOrSpec: mapping.offerTenderWording,
    stageCode: inferOfferStageCode(mapping.taskName),
  };
}

export function getIncludedOfferTenderLineItems(
  lines: readonly OfferWorkspaceCostLine[],
): readonly string[] {
  return Array.from(
    new Set(
      lines
        .filter(
          (line) =>
            line.includedInContract &&
            line.costExGst > 0 &&
            line.offerTenderLineItem.trim().length > 0,
        )
        .map((line) => line.offerTenderLineItem.trim()),
    ),
  );
}

function slugifyTaskName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferOfferStageCode(taskName: string): OfferStageCode {
  const lowerName = taskName.toLowerCase();

  if (
    /general|plan|basix|nathers|permit|survey|engineer|council|legal|service fee|water|warranty|licence|admin/.test(
      lowerName,
    )
  ) {
    return "A";
  }
  if (/temporary fence|scaffold|bin|pest/.test(lowerName)) {
    return "B";
  }
  if (/slab|drop edge|pier|concrete/.test(lowerName)) {
    return "C";
  }
  if (/frame|steel|roof/.test(lowerName)) {
    return "D";
  }
  if (/window|brick|garage door|render|cladding|facade/.test(lowerName)) {
    return "E";
  }
  if (/plumb|hot water|gas/.test(lowerName)) {
    return "F";
  }
  if (/electric|light/.test(lowerName)) {
    return "G";
  }
  if (/air conditioning|hvac/.test(lowerName)) {
    return "H";
  }
  if (/insulation|gyprock|stair|door|lock|carpenter|wardrobe|floor/.test(lowerName)) {
    return "I";
  }
  if (/waterproof|tile|tiling|sand|cement/.test(lowerName)) {
    return "J";
  }
  if (/kitchen|bath|stone|shower|appliance/.test(lowerName)) {
    return "K";
  }
  if (/pc item|selection|tapware|fixture/.test(lowerName)) {
    return "L";
  }
  if (/paint|silicon/.test(lowerName)) {
    return "M";
  }
  if (/driveway|landsc|fence|pool|solar|balcony|void/.test(lowerName)) {
    return "N";
  }

  return "O";
}
