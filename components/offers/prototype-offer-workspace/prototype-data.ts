// PROTOTYPE — throwaway. Not imported by production code.
//
// Mock state for the offer-workspace redesign prototype. Everything here is
// in-memory: no persistence, no server actions, no validation. The point is to
// answer two questions before any real code changes:
//
//   1. Does a step rail + one focused work pane beat the 13,867px single scroll?
//   2. What shape does the dwelling/duplex field model want to be?
//
// Numbers are lifted from the real sandbox offer RC-Q-2026-023-R3 so the
// density on screen is honest.

export type PrototypeBuildKind =
  | "single"
  | "duplex_attached"
  | "duplex_detached"
  | "knockdown_rebuild";

export const BUILD_KINDS: readonly {
  readonly value: PrototypeBuildKind;
  readonly label: string;
  readonly hint: string;
  // How many dwelling records this build kind seeds. Attached duplex is ONE
  // combined record (it is built and measured as a single building); detached
  // duplex is two independent dwellings.
  readonly seedsDwellings: number;
}[] = [
  {
    value: "single",
    label: "Single dwelling",
    hint: "One home on the lot.",
    seedsDwellings: 1,
  },
  {
    value: "duplex_attached",
    label: "Duplex — attached",
    hint: "Two homes sharing a party wall. Measured and costed as one building.",
    seedsDwellings: 1,
  },
  {
    value: "duplex_detached",
    label: "Duplex — detached",
    hint: "Two separate homes on one lot. Each is measured and costed on its own.",
    seedsDwellings: 2,
  },
  {
    value: "knockdown_rebuild",
    label: "Knockdown & rebuild",
    hint: "Demolition of the existing dwelling precedes the build.",
    seedsDwellings: 1,
  },
];

export type PrototypeDwellingRole = "primary" | "secondary" | "granny";

export type PrototypeDwelling = {
  readonly id: string;
  readonly name: string;
  readonly role: PrototypeDwellingRole;
  readonly storeys: 1 | 2;
  readonly facade: string;
  // Floor areas, m².
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly garageSqm: number;
  readonly alfrescoSqm: number;
  readonly porchSqm: number;
  readonly balconySqm: number;
  readonly voidSqm: number;
  // Room counts.
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly garageSpaces: number;
};

export const DWELLING_AREA_FIELDS: readonly {
  readonly key: keyof PrototypeDwelling;
  readonly label: string;
  // Areas that count toward the saleable/contract floor area vs. the ones that
  // are covered-but-not-enclosed. Today's UI sums all eight into one number and
  // never says which is which.
  readonly enclosed: boolean;
}[] = [
  { key: "groundFloorSqm", label: "Ground floor", enclosed: true },
  { key: "firstFloorSqm", label: "First floor", enclosed: true },
  { key: "garageSqm", label: "Garage", enclosed: true },
  { key: "alfrescoSqm", label: "Alfresco", enclosed: false },
  { key: "porchSqm", label: "Porch", enclosed: false },
  { key: "balconySqm", label: "Balcony", enclosed: false },
  { key: "voidSqm", label: "Void", enclosed: false },
];

export const FACADES = [
  "Contemporary",
  "Hamptons",
  "Federation",
  "Modern",
  "Coastal",
] as const;

// ── Duplex-specific particulars ────────────────────────────────────────────
// PROPOSED, not confirmed. These are the things a NSW duplex carries that a
// single dwelling does not, and that the offer currently has nowhere to put.
// Flagged in the UI so the estimator can tell us which are real.

export type PrototypeSubdivision = "none" | "torrens" | "strata";

export const SUBDIVISION_OPTIONS: readonly {
  readonly value: PrototypeSubdivision;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: "none",
    label: "Not subdivided",
    hint: "Both dwellings stay on the one title.",
  },
  {
    value: "torrens",
    label: "Torrens title",
    hint: "Lot split into two separate titles. Each dwelling sells on its own.",
  },
  {
    value: "strata",
    label: "Strata title",
    hint: "Two strata lots with common property.",
  },
];

export type PrototypeDuplexParticulars = {
  readonly subdivision: PrototypeSubdivision;
  readonly partyWallSpec: string;
  readonly separateWaterMeters: boolean;
  readonly separateElectrical: boolean;
  readonly separateSewerConnections: boolean;
  readonly separateDriveways: boolean;
  readonly hbcfPerDwelling: boolean;
};

export type PrototypeOwner = {
  readonly id: string;
  readonly kind: "individual" | "company";
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly currentLocation: string;
  readonly isSignatory: boolean;
};

export type PrototypeJob = {
  readonly reference: string;
  readonly revision: string;
  readonly status: string;
  readonly buildKind: PrototypeBuildKind;
  readonly owners: readonly PrototypeOwner[];
  readonly siteAddress: string;
  readonly siteCouncil: string;
  readonly lotAreaSqm: number;
  readonly dpNumber: string;
  readonly zoning: string;
  readonly validUntil: string;
  readonly preparedBy: string;
  readonly dwellings: readonly PrototypeDwelling[];
  readonly duplex: PrototypeDuplexParticulars;
};

export const EMPTY_DWELLING: Omit<PrototypeDwelling, "id" | "name" | "role"> = {
  storeys: 1,
  facade: "",
  groundFloorSqm: 0,
  firstFloorSqm: 0,
  garageSqm: 0,
  alfrescoSqm: 0,
  porchSqm: 0,
  balconySqm: 0,
  voidSqm: 0,
  bedrooms: 0,
  bathrooms: 0,
  garageSpaces: 0,
};

export const INITIAL_JOB: PrototypeJob = {
  reference: "RC-Q-2026-023",
  revision: "R3",
  status: "Working draft",
  buildKind: "duplex_detached",
  owners: [
    {
      id: "o1",
      kind: "individual",
      name: "Noby Jose",
      email: "noby.jose@example.com",
      phone: "0827 193 654",
      currentLocation: "Unit 3/34 Goulburn St, Liverpool NSW 2170",
      isSignatory: true,
    },
    {
      id: "o2",
      kind: "individual",
      name: "Ligy Rose Kurian",
      email: "ligy.kurian@example.com",
      phone: "",
      currentLocation: "Unit 3/34 Goulburn St, Liverpool NSW 2170",
      isSignatory: true,
    },
    {
      id: "o3",
      kind: "individual",
      name: "Khushi Singh",
      email: "khushi.singh@example.com",
      phone: "",
      currentLocation: "Unit 3/34 Goulburn St, Liverpool NSW 2170",
      isSignatory: false,
    },
  ],
  siteAddress: "34 Goulburn Swy, Liverpool NSW 2170",
  siteCouncil: "Liverpool City Council",
  lotAreaSqm: 910,
  dpNumber: "",
  zoning: "",
  validUntil: "2026-09-24",
  preparedBy: "Gurpinder Uppal — Director, Royal Constructions",
  dwellings: [
    {
      id: "d1",
      name: "Dwelling 1 — 34A",
      role: "primary",
      storeys: 2,
      facade: "Contemporary",
      groundFloorSqm: 185,
      firstFloorSqm: 145,
      garageSqm: 38,
      alfrescoSqm: 25,
      porchSqm: 8,
      balconySqm: 12,
      voidSqm: 15,
      bedrooms: 5,
      bathrooms: 3,
      garageSpaces: 2,
    },
    {
      id: "d2",
      name: "Dwelling 2 — 34B",
      role: "secondary",
      storeys: 2,
      facade: "Contemporary",
      groundFloorSqm: 180,
      firstFloorSqm: 100,
      garageSqm: 20,
      alfrescoSqm: 0,
      porchSqm: 32,
      balconySqm: 8,
      voidSqm: 10,
      bedrooms: 4,
      // 2.5 = two bathrooms plus a powder room. Seeded deliberately: it is the
      // value that a digits-only input silently turns into 25.
      bathrooms: 2.5,
      garageSpaces: 1,
    },
  ],
  duplex: {
    subdivision: "torrens",
    partyWallSpec: "",
    separateWaterMeters: true,
    separateElectrical: true,
    separateSewerConnections: false,
    separateDriveways: true,
    hbcfPerDwelling: true,
  },
};

// ── Derived ────────────────────────────────────────────────────────────────

export function dwellingEnclosedSqm(d: PrototypeDwelling): number {
  return DWELLING_AREA_FIELDS.filter((f) => f.enclosed).reduce(
    (sum, f) => sum + (d[f.key] as number),
    0,
  );
}

export function dwellingTotalSqm(d: PrototypeDwelling): number {
  return DWELLING_AREA_FIELDS.reduce((sum, f) => sum + (d[f.key] as number), 0);
}

export function jobTotalSqm(job: PrototypeJob): number {
  return job.dwellings.reduce((sum, d) => sum + dwellingTotalSqm(d), 0);
}

export function isDuplex(kind: PrototypeBuildKind): boolean {
  return kind === "duplex_attached" || kind === "duplex_detached";
}

// ── Workflow steps ─────────────────────────────────────────────────────────

export type PrototypeStepState = "complete" | "incomplete" | "active" | "locked";

export type PrototypeStep = {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly phase: "Offer" | "Tender" | "Contract" | "Handoff";
  readonly state: PrototypeStepState;
  // The one-line answer to "what does this step currently say?" — shown in the
  // rail so the estimator never has to open a step to read its result.
  readonly digest: string;
};

export const STEPS: readonly PrototypeStep[] = [
  {
    id: "job-setup",
    index: 1,
    label: "Job setup",
    phase: "Offer",
    state: "active",
    digest: "2 dwellings · 838 m²",
  },
  {
    id: "cost-schedule",
    index: 2,
    label: "Cost schedule",
    phase: "Offer",
    state: "complete",
    digest: "48 lines · $2,697,000",
  },
  {
    id: "pricing",
    index: 3,
    label: "Pricing",
    phase: "Offer",
    state: "complete",
    digest: "20% margin · $3,639,541",
  },
  {
    id: "scope",
    index: 4,
    label: "Scope",
    phase: "Offer",
    state: "complete",
    digest: "9 allowances · 12 exclusions",
  },
  {
    id: "document",
    index: 5,
    label: "Offer document",
    phase: "Offer",
    state: "incomplete",
    digest: "3 of 6 images set",
  },
  {
    id: "send",
    index: 6,
    label: "Send & negotiate",
    phase: "Offer",
    state: "incomplete",
    digest: "Not sent · 2 blockers",
  },
  {
    id: "tender-access",
    index: 7,
    label: "Tender access",
    phase: "Tender",
    state: "locked",
    digest: "Unlocks when the offer is agreed",
  },
  {
    id: "tender",
    index: 8,
    label: "Tender",
    phase: "Tender",
    state: "locked",
    digest: "Unlocks after tender access",
  },
  {
    id: "contract",
    index: 9,
    label: "Contract",
    phase: "Contract",
    state: "locked",
    digest: "Unlocks when the tender is signed",
  },
  {
    id: "project",
    index: 10,
    label: "Project",
    phase: "Handoff",
    state: "locked",
    digest: "Unlocks when the contract is signed",
  },
];

// ── Pricing (read-only in the prototype) ───────────────────────────────────

export const PRICING = {
  contractValueIncGst: 3639541,
  perSqm: 4343.13,
  rows: [
    ["Direct total", 2697000],
    ["Fixed additions", 60228],
    ["Cost before fee", 2757228],
    ["Royal Construction Overhead", 275723],
    ["Royal Construction Fee", 275723],
    ["Total inc construction", 3308674],
    ["GST", 330867],
  ] as const,
  marginPct: 0.2,
  marginStatus: "At target" as const,
};

// Derived, not a fixed list: a blocker that does not clear when the estimator
// fixes it is worse than no blocker at all.
export function sendBlockers(job: PrototypeJob): readonly string[] {
  const out: string[] = [];
  for (const d of job.dwellings) {
    if (!d.facade) out.push(`${d.name} has no façade selected`);
    if (dwellingEnclosedSqm(d) === 0) out.push(`${d.name} has no floor areas`);
  }
  if (!job.dpNumber.trim()) out.push("DP / title reference is empty");
  if (!job.zoning.trim()) out.push("Zoning is empty");
  if (!job.owners.some((o) => o.isSignatory))
    out.push("No owner is marked as a signatory");
  return out;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}
