import type { OfferWorkspacePricingSettings } from "@/lib/offer/workspace-pricing";
import {
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingByTask,
  type OfferSequenceMapping,
} from "@/lib/offer/workspace-sequence-mapping";
import {
  OFFER_EXCLUDES_BULLETS,
  OFFER_INCLUDES_BULLETS,
} from "@/lib/offer/workspace-proposal-content";

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

// ─── Owner parties (issues #103 / #111 / #120; ADR 0003) ───

// Signatory capacities. Individuals sign in their own right ("Owner"); a company
// owner signs through its directors ("Director"). Stored as free strings on the
// signatory + EnvelopeSignature so unusual capacities (e.g. "Trustee") are
// possible, with these two as the canonical defaults.
export const OWNER_SIGNER_CAPACITY = "Owner" as const;
export const DIRECTOR_SIGNER_CAPACITY = "Director" as const;

export type OfferOwnerKind = "individual" | "company";

// One natural person who must sign. For an individual owner this is the owner
// themselves (capacity "Owner"); for a company owner these are its directors
// (capacity "Director"). Each maps 1:1 to a DocuSign recipient with its own
// tracked signing link + status (#120).
export type OfferOwnerSignatory = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly capacity: string;
};

// A party on the customer side of the deal (an "Owner" — see CONTEXT.md). This
// is the SOURCE OF TRUTH for client identity on the offer. The flat client*
// fields on OfferWorkspaceJob are a derived primary/secondary projection kept
// for legacy renderers; N-owner / company rendering + signing reads owners[].
export type OfferOwner = {
  readonly id: string;
  readonly kind: OfferOwnerKind;
  // Individual: the person's full name. Company: the registered company name.
  // Rendered on the Contract OWNER(S) line and the Tender party block.
  readonly displayName: string;
  // The party's "Current Location": residential address (individual) or
  // registered office (company). Captured on Job setup via /api/address.
  readonly currentLocation: string;
  // Company only: ABN or ACN. Empty string for individuals.
  readonly abn: string;
  // Individual: exactly one signatory (the person, capacity "Owner").
  // Company: one or more director signatories (capacity "Director").
  readonly signatories: readonly OfferOwnerSignatory[];
};

export type OfferWorkspaceJob = {
  readonly reference: string;
  readonly revision: string;
  // Source of truth for the customer side (issues #103/#111). One or more
  // owners, each an individual or a company with director signatories.
  readonly owners: readonly OfferOwner[];
  // ── Derived legacy projection of owners[] (primary = owners[0], secondary =
  // owners[1]). Never edited directly — recomputed from owners[] via
  // deriveOwnerProjection so legacy renderers/consumers stay correct for the
  // common 1–2 owner case. Prefer reading owners[] in new code. ──
  readonly clientNames: string;
  // Secondary client sourced from the lead's secondaryName — rendered at the
  // existing client insertion points in the Offer/Tender/Contract documents
  // (cover row, greeting, signature block, acceptance paragraph). Empty string
  // means no secondary client; blanks are skipped in the renderers so
  // single-client offers stay unchanged.
  readonly secondaryCustomerName: string;
  readonly clientEmail: string;
  // Secondary client's own email. Used to address the offer/Tender/Contract
  // send to BOTH clients (a separate email + tracking token per recipient, so
  // the reply tracker attributes each reply to the right sender). Blank when
  // there is no secondary client; in that case the secondary owner (if any)
  // falls back to the primary clientEmail, matching the pre-existing DocuSign
  // behaviour.
  readonly secondaryCustomerEmail: string;
  readonly clientPhone: string;
  // Primary owner's Current Location (residential/postal), derived from
  // owners[0]. Printed on the Offer one-pager, Tender, and the Contract "of …"
  // line. Distinct from siteAddress. See CONTEXT.md "Current Location".
  readonly currentLocation: string;
  // The construction Site Location. Kept as siteAddress for back-compat; the
  // council/state/postcode below enrich it from /api/address (site council
  // feeds Project.council at handoff).
  readonly siteAddress: string;
  readonly siteCouncil: string;
  readonly siteState: string;
  readonly sitePostcode: string;
  readonly buildType: string;
  readonly facade: string;
  readonly groundFloorSqm: number;
  readonly firstFloorSqm: number;
  readonly garageSqm: number;
  readonly alfrescoPorchSqm: number;
  readonly porchSqm: number;
  readonly grannyFlatSqm: number;
  readonly validUntil: string;
  readonly preparedBy: string;
  // Project snapshot (site particulars shown on the proposal snapshot page).
  readonly lotAreaSqm: number;
  readonly dpNumber: string;
  readonly zoning: string;
  readonly buildScope: readonly string[];
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
  | "tender_declined"
  | "contract_draft"
  | "contract_sent"
  | "contract_signed"
  | "contract_declined"
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
  tender_declined: "Tender declined",
  contract_draft: "Contract draft",
  contract_sent: "Contract sent",
  contract_signed: "Contract signed",
  contract_declined: "Contract declined",
  project: "Project",
  rejected: "Rejected",
  superseded: "Superseded",
};

// Royal quote build-up defaults (verified against real workbooks). The Royal
// Construction Fee is the margin lever — 20% is the most common; estimators
// set it per job. Admin ~$5k and Labour ~$10k are the usual standing additions;
// the rest are entered per job.
export const DEFAULT_WORKSPACE_PRICING_SETTINGS: OfferWorkspacePricingSettings = {
  royalConstructionFeePct: 0.2,
  gstRate: 0.1,
  homeWarrantyHbcfFixed: 0,
  adminCostFixed: 5000,
  engineeringFixed: 0,
  legalFixed: 0,
  impactFeeFixed: 0,
  labourCostFixed: 10000,
  licenceFixed: 0,
};

// Façade options the client picks in Job setup. `imageHint` is the visual
// descriptor woven into the exterior AI image prompts (see offer-image-context).
export const FACADE_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
  readonly imageHint: string;
}[] = [
  {
    value: "Modern rendered",
    label: "Modern rendered",
    imageHint:
      "fully rendered contemporary facade, clean rectilinear lines, feature entry",
  },
  {
    value: "Face brick",
    label: "Face brick",
    imageHint: "full face brick facade",
  },
  {
    value: "Brick & render",
    label: "Brick & render",
    imageHint: "mixed face brick and rendered feature facade",
  },
  {
    value: "Hamptons",
    label: "Hamptons",
    imageHint:
      "Hamptons-style facade, weatherboard cladding, gabled roof, portico entry",
  },
  {
    value: "Contemporary",
    label: "Contemporary",
    imageHint:
      "contemporary facade, mixed materials with timber and stone accents",
  },
  {
    value: "Coastal",
    label: "Coastal",
    imageHint: "coastal facade, light palette, timber batten accents, large windows",
  },
];

// Visual descriptor for a selected façade, or "" when none/unknown.
export function facadeImageHint(facade: string): string {
  return FACADE_OPTIONS.find((option) => option.value === facade)?.imageHint ?? "";
}

// A fresh offer starts with blank client/site identity — it is synced from the
// DB reference and pre-filled from the lead on load (see NewOfferWorkspace).
// The floor-area / cost figures below remain a working seed the estimator
// overwrites via the workbook import or manual entry.
// A new offer is valid for 30 days from when it is opened. Derived at runtime
// (not baked as a constant) so a freshly created offer is never already
// expired. Returns a YYYY-MM-DD date-only string, matching validUntil's shape.
export const OFFER_VALIDITY_DAYS = 30;

export function defaultOfferValidUntil(from: Date = new Date()): string {
  const until = new Date(from);
  until.setDate(until.getDate() + OFFER_VALIDITY_DAYS);
  return until.toISOString().slice(0, 10);
}

// ─── Owner helpers (ADR 0003) ───

export function createOfferSignatory(
  id: string,
  capacity: string,
): OfferOwnerSignatory {
  return { id, name: "", email: "", phone: "", capacity };
}

// A blank individual owner: one signatory (the person themselves, capacity
// "Owner").
export function createIndividualOwner(id: string): OfferOwner {
  return {
    id,
    kind: "individual",
    displayName: "",
    currentLocation: "",
    abn: "",
    signatories: [createOfferSignatory(`${id}-signer-1`, OWNER_SIGNER_CAPACITY)],
  };
}

// A blank company owner: one director signatory to start (capacity "Director").
export function createCompanyOwner(id: string): OfferOwner {
  return {
    id,
    kind: "company",
    displayName: "",
    currentLocation: "",
    abn: "",
    signatories: [createOfferSignatory(`${id}-dir-1`, DIRECTOR_SIGNER_CAPACITY)],
  };
}

// The primary owner (first in the list), or undefined when there are none.
export function primaryOwner(
  owners: readonly OfferOwner[],
): OfferOwner | undefined {
  return owners[0];
}

// One customer-side signer (an individual owner, or one director of a company
// owner), with the represented entity so the signature record + printed block
// can show the signing capacity.
export type OfferSignerContext = {
  readonly owner: OfferOwner;
  readonly signatory: OfferOwnerSignatory;
  readonly ownerIndex: number;
  readonly signerIndex: number;
  // Represented company (name + abn) when the owner is a company; null for an
  // individual signing in their own right.
  readonly entityName: string | null;
  readonly entityAbn: string | null;
};

// Every customer-side signer across all owners, in owner-then-signatory order —
// the exact set of DocuSign recipients (all routingOrder 1; builder counter-
// signs last). Each individual owner contributes one signer; each company owner
// contributes one per director.
export function collectOfferSigners(
  owners: readonly OfferOwner[],
): OfferSignerContext[] {
  const signers: OfferSignerContext[] = [];
  owners.forEach((owner, ownerIndex) => {
    owner.signatories.forEach((signatory, signerIndex) => {
      signers.push({
        owner,
        signatory,
        ownerIndex,
        signerIndex,
        entityName: owner.kind === "company" ? owner.displayName : null,
        entityAbn: owner.kind === "company" ? owner.abn : null,
      });
    });
  });
  return signers;
}

// Display label for one customer-side signer in the workspace UI (tender/contract
// preview signature lines + the DocuSign signing tracker). An individual owner
// shows their name; a company director shows "Name (Director, Company)". This
// MUST mirror collectOfferSigners so the UI shows exactly the recipients that are
// actually sent to DocuSign — the on-screen preview must not diverge from the
// envelope (the bug: the panels rendered the legacy clientNames/secondary
// projection and a hardcoded 2-recipient list instead).
export function offerSignerLabel(signer: OfferSignerContext): string {
  const name = signer.signatory.name.trim();
  if (signer.entityName) {
    const capacity = signer.signatory.capacity.trim() || DIRECTOR_SIGNER_CAPACITY;
    const who = name || capacity;
    return `${who} (${capacity}, ${signer.entityName})`;
  }
  return name || OWNER_SIGNER_CAPACITY;
}

// The ordered customer-signer display labels for a set of owners — the exact
// customer parties the DocuSign envelope carries, formatted for the UI.
export function collectOfferSignerLabels(
  owners: readonly OfferOwner[],
): string[] {
  return collectOfferSigners(owners).map(offerSignerLabel);
}

const OWNER_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Completeness issues for the owner party set (codex review; issues #109/#110/
// #103): every owner needs a name and a Current Location, and every signatory a
// name + valid own email. Returned as human-readable labels. Shared by the
// readiness review (badge), the offer-document send blockers (client gate), and
// the server send guard — so an offer can't be sent/locked with party data that
// would print blank on the legal documents or route a signing link nowhere.
export function collectOwnerIssues(owners: readonly OfferOwner[]): string[] {
  const named = owners.filter((owner) => owner.displayName.trim().length > 0);
  if (named.length === 0) {
    return ["Add at least one owner with a name."];
  }
  const issues: string[] = [];
  owners.forEach((owner, index) => {
    const isCompany = owner.kind === "company";
    const who = owner.displayName.trim() || `Owner ${index + 1}`;
    if (owner.displayName.trim().length === 0) {
      issues.push(`Owner ${index + 1} needs a ${isCompany ? "company name" : "name"}.`);
    }
    if (owner.currentLocation.trim().length === 0) {
      issues.push(
        `${who} needs a ${isCompany ? "registered office (Current Location)" : "Current Location"}.`,
      );
    }
    owner.signatories.forEach((signatory) => {
      if (signatory.name.trim().length === 0) {
        issues.push(`${who} has a ${isCompany ? "director" : "signatory"} without a name.`);
      }
      if (!OWNER_EMAIL_PATTERN.test(signatory.email.trim())) {
        const label =
          signatory.name.trim() || (isCompany ? "a director" : "the owner");
        issues.push(`${who}: ${label} needs a valid email.`);
      }
    });
  });
  return issues;
}

// The legacy flat client* projection (primary = owners[0], secondary =
// owners[1]) derived from owners[].
export type OfferClientProjection = {
  readonly clientNames: string;
  readonly secondaryCustomerName: string;
  readonly clientEmail: string;
  readonly secondaryCustomerEmail: string;
  readonly clientPhone: string;
  readonly currentLocation: string;
};

export function deriveOwnerProjection(
  owners: readonly OfferOwner[],
): OfferClientProjection {
  const primary = owners[0];
  const secondary = owners[1];
  const primarySigner = primary?.signatories[0];
  const secondarySigner = secondary?.signatories[0];
  return {
    clientNames: primary?.displayName ?? "",
    secondaryCustomerName: secondary?.displayName ?? "",
    clientEmail: primarySigner?.email ?? "",
    secondaryCustomerEmail: secondarySigner?.email ?? "",
    clientPhone: primarySigner?.phone ?? "",
    currentLocation: primary?.currentLocation ?? "",
  };
}

// Recompute the derived flat client* fields from owners[] and return the job
// with both in sync. Call after any owners[] mutation (Job setup) and on
// deserialize so legacy renderers/consumers always see a correct primary/
// secondary projection.
export function withOwnerProjection(job: OfferWorkspaceJob): OfferWorkspaceJob {
  return { ...job, ...deriveOwnerProjection(job.owners) };
}

// Combined display of every owner name for the Contract OWNER(S) line, e.g.
// "John Smith & Jane Smith & ABC Pty Ltd (ABN/ACN 12 345 678 901)".
export function formatOwnerNamesLine(owners: readonly OfferOwner[]): string {
  return owners
    .map((owner) => {
      const name = owner.displayName.trim();
      if (owner.kind === "company" && owner.abn.trim().length > 0) {
        return `${name} (ABN/ACN ${owner.abn.trim()})`;
      }
      return name;
    })
    .filter((entry) => entry.length > 0)
    .join(" & ");
}

// Build owners[] from the legacy flat client fields (migrate-on-read for
// pre-owners snapshots). The combined primary name string is kept as-is on
// owner 1 (NOT split on "&") so already-rendered offers stay byte-identical; a
// secondary client becomes owner 2. Always returns ≥1 owner.
export function ownersFromLegacyClientFields(fields: {
  clientNames: string;
  secondaryCustomerName: string;
  clientEmail: string;
  secondaryCustomerEmail: string;
  clientPhone: string;
  currentLocation?: string;
}): OfferOwner[] {
  const owners: OfferOwner[] = [
    {
      id: "owner-1",
      kind: "individual",
      displayName: fields.clientNames,
      currentLocation: fields.currentLocation ?? "",
      abn: "",
      signatories: [
        {
          id: "owner-1-signer-1",
          name: fields.clientNames,
          email: fields.clientEmail,
          phone: fields.clientPhone,
          capacity: OWNER_SIGNER_CAPACITY,
        },
      ],
    },
  ];
  if (fields.secondaryCustomerName.trim().length > 0) {
    owners.push({
      id: "owner-2",
      kind: "individual",
      displayName: fields.secondaryCustomerName,
      currentLocation: "",
      abn: "",
      signatories: [
        {
          id: "owner-2-signer-1",
          name: fields.secondaryCustomerName,
          email: fields.secondaryCustomerEmail || fields.clientEmail,
          phone: "",
          capacity: OWNER_SIGNER_CAPACITY,
        },
      ],
    });
  }
  return owners;
}

export const INITIAL_OFFER_JOB: OfferWorkspaceJob = {
  reference: "",
  revision: "R1",
  owners: [createIndividualOwner("owner-1")],
  clientNames: "",
  secondaryCustomerName: "",
  clientEmail: "",
  secondaryCustomerEmail: "",
  clientPhone: "",
  currentLocation: "",
  siteAddress: "",
  siteCouncil: "",
  siteState: "",
  sitePostcode: "",
  buildType: "",
  facade: "",
  groundFloorSqm: 0,
  firstFloorSqm: 0,
  garageSqm: 0,
  alfrescoPorchSqm: 0,
  porchSqm: 0,
  grannyFlatSqm: 0,
  // Seeded per-offer at runtime via defaultOfferValidUntil(); empty here so a
  // stale constant can't ship an already-expired date.
  validUntil: "",
  preparedBy: "Gurpinder Uppal - Director, Royal Constructions",
  lotAreaSqm: 0,
  dpNumber: "",
  zoning: "",
  buildScope: [],
};

// A fresh offer starts with zero costs — the cost-schedule rows are present
// (from the sequence mappings) but priced at $0 until the estimator enters
// costs or imports the workbook. No sample figures.
const INITIAL_COST_BY_TASK = new Map<string, number>([]);

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
  headline: "Your fixed price building proposal",
  introText:
    "This proposal forms the basis of a Master Builders Association (MBA) fixed price home building contract. Every item below is locked into your fixed contract price — a number you can take to your bank today.",
  inclusionBullets: OFFER_INCLUDES_BULLETS,
  exclusionBullets: OFFER_EXCLUDES_BULLETS,
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

// A blank scope item ready for the operator to fill in. Exclusions default to a
// note (no dollar amount); allowances to a fixed amount. The `id` is supplied by
// the caller so it stays stable and serializable in the snapshot.
export function createOfferScopeItem(
  id: string,
  category: OfferScopeItemCategory,
): OfferWorkspaceScopeItem {
  return {
    id,
    category,
    amountType: category === "exclusion" ? "included_note" : "fixed_amount",
    label: "",
    description: "",
    amount: 0,
    unit: "",
    variationRule: "",
    includedInOfferDocument: true,
  };
}

export function removeOfferScopeItem(
  items: readonly OfferWorkspaceScopeItem[],
  itemId: string,
): readonly OfferWorkspaceScopeItem[] {
  return items.filter((item) => item.id !== itemId);
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
    /general|plan|basix|nathers|permit|survey|engineer|council|legal|service fee|sydney water|sewer|warranty|licence|admin/.test(
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
