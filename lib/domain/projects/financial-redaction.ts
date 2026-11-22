import type { ProjectRequirementsPayload } from "@/types/project-flow";
import type { ComplianceDocumentType } from "@prisma/client";
import { parseQuotedAmount } from "@/utils/calculations";

import { canSeeProjectFinancials } from "../access/projects";
import { HBCF_FILE_TAG, projectHbcfFileIds } from "../insurance/hbcf-claims";
import { isTenderOrContractName, type ProjectDocument } from "./document-tags";
import type { DomainPrincipal } from "../principal";
import type {
  ProjectDetail,
  ProjectWithStats,
  SafeMilestone,
} from "@/types/project";

// What a project payload looks like to someone who may not see its money.
//
// The rule is `canSeeProjectFinancials`; this is the other half of it, the
// shape. It is applied to the DTO after it is built, in `queries.ts`, because
// that module is the only reader of the Project table for the screens, the
// API and the agent: one place to apply it is one place to forget it.
//
// Hidden is not free. Every amount becomes "0" (the DTO types say string, and
// a screen that does `Number(x)` must not meet `undefined`), every money list
// becomes empty, and `financialsHidden` is set so a screen can tell "hidden"
// from "$0.00" and draw nothing.
//
// Not covered here, on purpose: the milestone and tradie-schedule routes and
// the tradie directory build their own payloads. They reuse these helpers.

export const HIDDEN_AMOUNT = "0";

/** The commercial section with nothing in it. Valid by type: all nullable. */
const NO_COMMERCIALS: ProjectRequirementsPayload["commercialsAndClaims"] = {
  claimStageSlabDollarValue: null,
  claimStageSlabPercentage: null,
  depositValue: null,
  gstAmount: null,
  gstIncluded: null,
  latePenaltyRate: null,
  paymentStages: [],
  totalContractSum: null,
  variationAdminFee: null,
};

/** A source-document slot with no file behind it. */
/**
 * The extracted requirements without their commercial section, without any
 * HBCF field (`withoutHbcf`), and without the links to the tender and the
 * contract, which carry the price in full. The rest — wet areas, site safety,
 * inclusions — is what a site manager builds from, and stays.
 */
export function hideRequirementsFinancials(
  requirements: ProjectRequirementsPayload | undefined,
): ProjectRequirementsPayload | undefined {
  if (!requirements) return requirements;
  const legal = requirements.legalAdministration;
  // The tender and contract links are left out, not blanked. The Overview and
  // the Slab-start dialog send the whole requirements back on a save, and the
  // PATCH refuses a link with no file id, name or URL: blank placeholders made
  // every site manager's save a 400. A save drops the key anyway and keeps the
  // stored links (`withoutFinancialEdits`), and no screen of theirs reads it.
  const rest: Partial<ProjectRequirementsPayload> = { ...requirements };
  delete rest.sourceDocuments;
  return {
    ...rest,
    commercialsAndClaims: NO_COMMERCIALS,
    ...(legal ? { legalAdministration: withoutHbcf(legal) } : {}),
  } as ProjectRequirementsPayload;
}

/**
 * The legal section without its HBCF fields. The certificate, its number and
 * the claim documents carry the contract value, the sum assured and the claim
 * amounts the pool is counted from, and the number alone is enough to fetch
 * the certificate: none of it is site work (owner, 2026-11-20, replacing the
 * earlier "amounts blanked, certificate openable"). A save puts the stored
 * fields back (`withStoredHbcf`), so leaving them out cannot erase them.
 */
function withoutHbcf<T extends object>(legal: T): T {
  const rest = { ...legal } as Record<string, unknown>;
  for (const field of HBCF_FIELDS) delete rest[field];
  return rest as T;
}

/** The legal-section fields that record the HBCF certificate and claims. */
const HBCF_FIELDS = [
  "hbcfClaimDocuments",
  "hbcfInsuranceDocument",
  "hbcfInsuranceNumber",
] as const;

/**
 * A legal-section edit with its HBCF fields put back to the stored ones, for a
 * caller who is not the office.
 *
 * HBCF is recorded by the office: the certificate, its number and the claim
 * documents, whose confirmed amounts make up the company's HBCF pool. A site
 * manager's screen shows them read-only and is handed the amounts blanked, so
 * whatever their save carries for these fields — the blanked amounts, an
 * edited certificate number, a document added or left out, a `null` — is
 * replaced with what is stored (#560). A field the project has never had is
 * not created. The rest of the section (site address, contacts, signed date,
 * the insurance claim dates captured at the Slab start) is theirs to edit.
 */
export function withStoredHbcf<T>(incomingLegal: T, storedLegal: unknown): T {
  if (!incomingLegal || typeof incomingLegal !== "object") return incomingLegal;
  const stored =
    storedLegal && typeof storedLegal === "object"
      ? (storedLegal as Record<string, unknown>)
      : {};
  const legal = { ...(incomingLegal as Record<string, unknown>) };
  for (const field of HBCF_FIELDS) {
    if (field in stored) legal[field] = stored[field];
    else delete legal[field];
  }
  return legal as T;
}

/** A milestone without its budget, spend or the office's tradie figures. */
export function hideMilestoneFinancials<
  T extends Pick<SafeMilestone, "budget" | "spend">,
>(milestone: T): T {
  return {
    ...milestone,
    budget: HIDDEN_AMOUNT,
    spend: milestone.spend === undefined ? undefined : HIDDEN_AMOUNT,
    // Present on a detail row (they are typed on the Prisma model), absent on
    // a narrower select; both ways nothing survives.
    ...("tradieQuotedOverride" in milestone
      ? { tradieQuotedOverride: null, tradieInvoicedOverride: null }
      : {}),
  };
}

/** A project row for the list, the quick view and the CSV export. */
export function hideListProjectFinancials(
  project: ProjectWithStats,
): ProjectWithStats {
  return {
    ...project,
    approvedVariationSpend: HIDDEN_AMOUNT,
    financialsHidden: true,
    // The sales record this project came from (#570): see the detail below.
    leadId: null,
    invoiceTotals: {
      invoiced: "0.00",
      outstanding: "0.00",
      paid: "0.00",
      pendingCount: 0,
    },
    invoices: [],
    requirements: hideRequirementsFinancials(project.requirements),
    spent: HIDDEN_AMOUNT,
    totalBudget: HIDDEN_AMOUNT,
  };
}

/**
 * Documents tab rows that belong to the office: the sales lead, tradie
 * invoices and variations (prices, the contract value).
 */
const OFFICE_DOCUMENT_SOURCES: ReadonlySet<ProjectDocument["source"]> = new Set(
  ["lead", "tradie-invoice", "variation"],
);

/**
 * What a site manager builds from, of everything filed on the compliance file:
 * the plans, the site's survey and reports, and the approvals. An allow-list:
 * the rest — the HBCF certificate, the build cost summary, fee proposals and
 * invoices, the land deed and owner's consent, application forms, and anything
 * not yet identified — stays with the office (owner, 2026-11-20).
 */
const BUILD_DOCUMENT_TYPES: ReadonlySet<ComplianceDocumentType> = new Set([
  "DEPOSITED_PLAN",
  "TITLE_SEARCH_DETAIL_AND_LEVEL",
  "SURVEY",
  "PRELIMINARY_ARCHITECTURAL_PLANS",
  "FULL_ARCHITECTURAL_DESIGN",
  "PLANNING_CERTIFICATE_10_7",
  "BASIX_CERTIFICATE",
  "BUSHFIRE_REPORT",
  "STRUCTURAL_DRAWINGS",
  "HYDRAULIC_STORMWATER_DRAWINGS",
  "GEOTECH_REPORT",
  "WATER_SERVICING_APPROVAL",
  "SECTION_73_NOTICE",
  "ROAD_OPENING_PERMIT",
  "MINE_SUBSIDENCE_APPROVAL",
  "WASTE_MANAGEMENT_PLAN",
  "TRAFFIC_CONTROL_PLAN",
  "DEVELOPMENT_CONSENT",
  "CONSTRUCTION_CERTIFICATE",
  "COMPLYING_DEVELOPMENT_CERTIFICATE",
] satisfies ComplianceDocumentType[]);

/** Whether a compliance document is one a site manager builds from. */
export function isBuildDocumentType(
  type: ComplianceDocumentType | null | undefined,
): boolean {
  return type != null && BUILD_DOCUMENT_TYPES.has(type);
}

const SOURCE_DOCUMENT_TAGS: ReadonlySet<string> = new Set([
  "tender",
  "contract",
]);

/**
 * The tender and contract links on the requirements, as a matcher. The Overview
 * card can repoint a link by URL alone (`fileId` stays as it was), so a file
 * matches on either its id or its URL.
 */
function sourceDocumentMatcher(
  requirements: ProjectRequirementsPayload | undefined,
) {
  const refs = [
    requirements?.sourceDocuments?.tender,
    requirements?.sourceDocuments?.contract,
  ].filter((ref) => ref != null);
  const fileIds = new Set(
    refs.flatMap((ref) => (ref.fileId ? [ref.fileId] : [])),
  );
  const urls = new Set(refs.flatMap((ref) => (ref.url ? [ref.url] : [])));
  return (fileId: string | null, url: string | null) =>
    (fileId !== null && fileIds.has(fileId)) || (url !== null && urls.has(url));
}

/**
 * Files that are the office's whatever else they are: the HBCF certificate and
 * claim documents (contract value, sum assured, claim amounts) and the tender
 * and contract (the full contract price), filed as ordinary project files.
 * One matcher for the project detail and the file download
 * (`canReadFile`), so the two cannot disagree.
 *
 * HBCF: the file ids the legal section links, or the HBCF upload's tag (a
 * replaced certificate is no longer linked). Tender and contract: the file id
 * or URL `sourceDocuments` links (the Overview card can repoint by URL alone),
 * an exact Tender/Contract tag, then the Documents tab's name rule.
 */
export function officeOnlyFileMatcher(requirements: unknown) {
  const payload = requirements as ProjectRequirementsPayload | undefined;
  const hbcfFileIds = projectHbcfFileIds(
    payload?.legalAdministration as Parameters<typeof projectHbcfFileIds>[0],
  );
  const isLinkedSource = sourceDocumentMatcher(payload);
  return (file: {
    readonly id: string | null;
    readonly url: string | null;
    readonly name: string | null | undefined;
    readonly tags: readonly string[] | null | undefined;
  }): boolean => {
    const tags = file.tags ?? [];
    return (
      (file.id !== null && hbcfFileIds.has(file.id))
      || tags.includes(HBCF_FILE_TAG)
      || isLinkedSource(file.id, file.url)
      || tags.some((tag) => SOURCE_DOCUMENT_TAGS.has(tag.toLowerCase()))
      || isTenderOrContractName(file.name)
    );
  };
}

/** The whole detail payload: contract, claims, variations, quotes, costs. */
export function hideDetailProjectFinancials(
  project: ProjectDetail,
): ProjectDetail {
  const isOfficeFile = officeOnlyFileMatcher(project.requirements);
  const documents = project.documents.filter(
    (document) =>
      !OFFICE_DOCUMENT_SOURCES.has(document.source)
      && !isOfficeFile({
        id: document.fileId,
        name: document.name,
        tags: document.tags,
        url: document.url,
      })
      && (document.source !== "compliance"
        || isBuildDocumentType(document.complianceDocumentType)),
  );
  const buildFileIds = new Set(
    documents
      .filter((document) => document.source === "compliance")
      .map((document) => document.fileId),
  );
  return {
    ...project,
    // The History tab is the office's audit trail (`canSeeProjectHistory`).
    activityLogs: [],
    documents,
    // The raw files too, not only the Documents rows: the Documents tab
    // rebuilds a row from any file it is handed. A file filed on the
    // compliance file or brought over from the lead keeps its projectId, so a
    // compliance file stays only as a build document kept above.
    files: project.files.filter(
      (file) =>
        !isOfficeFile({
          id: file.id,
          name: file.filename,
          tags: file.tags,
          url: file.url,
        })
        && file.leadId === null
        && (!file.complianceDocumentId || buildFileIds.has(file.id)),
    ),
    // The compliance file (documents, certifier, its emails) is the office's
    // (`canWorkComplianceFile`); the HBCF certificate can be filed there too.
    certifierEngagement: null,
    financialsHidden: true,
    invoices: [],
    // The lead this project came from is the sales record: its email thread
    // carries the quotation and its price, and the rest of it only repeats the
    // customer's details and links back into sales. A site manager keeps the
    // client's contact details on `customer` (#570).
    lead: null,
    leadId: null,
    materials: project.materials.map((material) => ({
      ...material,
      totalCost: HIDDEN_AMOUNT,
      unitCost: HIDDEN_AMOUNT,
    })),
    milestones: project.milestones.map(hideMilestoneFinancials),
    requirements: hideRequirementsFinancials(project.requirements),
    siteUpdates: project.siteUpdates.map((siteUpdate) => ({
      ...siteUpdate,
      milestone: hideMilestoneFinancials(siteUpdate.milestone),
    })),
    spent: HIDDEN_AMOUNT,
    totalBudget: HIDDEN_AMOUNT,
    tradieSchedules: project.tradieSchedules.map((schedule) => ({
      ...schedule,
      billing: null,
      // Whether a price came in, without the price: the Tradies tab would
      // otherwise say "No quote yet" about a booking that has one.
      hasQuotedPrice: parseQuotedAmount(schedule.quotedPrice) !== null,
      milestone: schedule.milestone
        ? hideMilestoneFinancials(schedule.milestone)
        : schedule.milestone,
      // The office writes terms and amounts into a quote's notes.
      quote: schedule.quote
        ? { ...schedule.quote, notes: null }
        : schedule.quote,
      quotedPrice: null,
      tradie: {
        ...schedule.tradie,
        lastQuotedPrice: undefined,
      },
    })),
    variations: [],
  };
}

const QUOTE_KEYS = new Set(["quotedPrice", "lastQuotedPrice"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A payload with every tradie quote taken out of it, wherever it sits.
 *
 * For the booking lists, whose shape this module does not own: a key walk is
 * the only thing that covers a payload built by raw SQL as well as one built by
 * Prisma. Only arrays and plain objects are copied, so a `Date` stays a `Date`.
 * `quotedPrice` and `lastQuotedPrice` mean one thing in this codebase — a
 * tradie's price — which is what makes a name match safe.
 */
export function withoutTradieQuotes<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => withoutTradieQuotes(item)) as T;
  }
  if (!isPlainObject(payload)) return payload;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    copy[key] = QUOTE_KEYS.has(key) ? undefined : withoutTradieQuotes(value);
  }
  return copy as T;
}

/**
 * A project edit with the money put back, for a caller who may not see it.
 *
 * The other half of hiding the figures. A form that was handed zeros saves
 * them back: `totalBudget: "0"`, and a `commercialsAndClaims` with no payment
 * stages, which is what progress claims are raised from. So an edit from
 * someone who cannot see the money neither sets the contract sum nor replaces
 * the commercial terms.
 *
 * The save writes `requirements` whole, not merged, so leaving the commercial
 * section out would delete it: it is replaced with the stored one instead, and
 * so are the tender and contract links, which were handed over blank. The HBCF
 * fields get the same treatment (`withStoredHbcf`).
 */
export function withoutFinancialEdits<
  T extends {
    totalBudget?: number;
    requirements?: Record<string, unknown>;
  },
>(
  principal: DomainPrincipal,
  input: T,
  stored: {
    commercialsAndClaims?: unknown;
    legalAdministration?: unknown;
    sourceDocuments?: unknown;
  },
): T {
  if (canSeeProjectFinancials(principal)) return input;
  const requirements = { ...input.requirements };
  delete requirements.commercialsAndClaims;
  // Handed blank tender and contract links, so it would save them blank.
  delete requirements.sourceDocuments;
  if (requirements.legalAdministration) {
    requirements.legalAdministration = withStoredHbcf(
      requirements.legalAdministration,
      stored.legalAdministration,
    );
  } else if ("legalAdministration" in stored) {
    // The save replaces `requirements` whole: a payload with no legal section
    // (or a null one) would delete the stored one, HBCF and all.
    requirements.legalAdministration = stored.legalAdministration;
  }
  return {
    ...input,
    requirements: input.requirements
      ? {
          ...requirements,
          ...("commercialsAndClaims" in stored
            ? { commercialsAndClaims: stored.commercialsAndClaims }
            : {}),
          ...("sourceDocuments" in stored
            ? { sourceDocuments: stored.sourceDocuments }
            : {}),
        }
      : undefined,
    totalBudget: undefined,
  };
}
