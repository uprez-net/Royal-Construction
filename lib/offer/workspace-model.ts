import type {
  LegacyWorkbookPricingSettings,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";

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
  readonly tradeOrVendor: string;
  readonly notesOrSpec: string;
  readonly costExGst: number;
  readonly includedInContract: boolean;
  readonly sourceReference?: string;
};

export type OfferWorkspaceScopeItem = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly amount: number;
  readonly includedInOfferDocument: boolean;
};

export type OfferDocumentDraft = {
  readonly headline: string;
  readonly introText: string;
  readonly inclusionBullets: readonly string[];
  readonly exclusionBullets: readonly string[];
  readonly termsSummary: string;
};

export type OfferWorkspaceStatus = "pending" | "sent";

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
  clientNames: "Mahesh and Anisha",
  clientEmail: "client@example.com",
  clientPhone: "0400 000 000",
  siteAddress: "13 Binalong Road, Pendle Hill NSW 2145",
  buildType: "Custom double storey",
  groundFloorSqm: 138,
  firstFloorSqm: 126,
  garageSqm: 36,
  alfrescoPorchSqm: 24,
  porchSqm: 8,
  grannyFlatSqm: 0,
  validUntil: "2026-07-30",
  preparedBy: "Royal Constructions",
};

export const INITIAL_COST_LINES: readonly OfferWorkspaceCostLine[] = [
  {
    id: "line-a-1",
    stageCode: "A",
    itemName: "Plans, approvals and engineering",
    tradeOrVendor: "Design / Certifier",
    notesOrSpec: "Drafting, BASIX, engineering and certifier allowances",
    costExGst: 28500,
    includedInContract: true,
  },
  {
    id: "line-c-1",
    stageCode: "C",
    itemName: "Slab and piering allowance",
    tradeOrVendor: "Concreter",
    notesOrSpec: "Standard slab with site-condition allowance",
    costExGst: 84500,
    includedInContract: true,
  },
  {
    id: "line-d-1",
    stageCode: "D",
    itemName: "Frame, trusses and roofing",
    tradeOrVendor: "Frame / Roof",
    notesOrSpec: "Timber frame, roof trusses, metal roofing and gutters",
    costExGst: 132000,
    includedInContract: true,
  },
  {
    id: "line-k-1",
    stageCode: "K",
    itemName: "Kitchen, bath and joinery",
    tradeOrVendor: "Joinery / PC items",
    notesOrSpec: "Joinery package with PC allowance selections",
    costExGst: 76000,
    includedInContract: true,
  },
  {
    id: "line-n-1",
    stageCode: "N",
    itemName: "Pool and extended landscaping",
    tradeOrVendor: "External works",
    notesOrSpec: "Optional owner scope, excluded from current offer",
    costExGst: 0,
    includedInContract: false,
  },
];

export const INITIAL_ALLOWANCES: readonly OfferWorkspaceScopeItem[] = [
  {
    id: "allowance-1",
    label: "Kitchen appliances",
    description: "Prime cost allowance for oven, cooktop and rangehood.",
    amount: 8500,
    includedInOfferDocument: true,
  },
  {
    id: "allowance-2",
    label: "Tiles and bathroom fixtures",
    description: "Selection allowance for wet-area tiles and tapware.",
    amount: 14000,
    includedInOfferDocument: true,
  },
];

export const INITIAL_EXCLUSIONS: readonly OfferWorkspaceScopeItem[] = [
  {
    id: "exclusion-1",
    label: "Pool, spa and water features",
    description: "Can be priced later as a variation or separate package.",
    amount: 0,
    includedInOfferDocument: true,
  },
  {
    id: "exclusion-2",
    label: "Window furnishings and loose furniture",
    description: "Owner selection outside the fixed-price building scope.",
    amount: 0,
    includedInOfferDocument: true,
  },
];

export const INITIAL_OFFER_DRAFT: OfferDocumentDraft = {
  headline: "Fixed price building offer",
  introText:
    "Royal Constructions is pleased to provide this fixed price offer based on the current plans, selections and assumptions captured in the internal cost schedule.",
  inclusionBullets: [
    "New custom dwelling construction based on the current drawing set",
    "Standard approvals, engineering, HBCF, site preparation and core building works",
    "Kitchen, bathroom and fixture allowances captured as prime cost items",
  ],
  exclusionBullets: [],
  termsSummary:
    "Final Tender is issued only after scope and price are agreed by builder and client.",
};
