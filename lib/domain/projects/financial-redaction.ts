import type {
  ProjectRequirementsPayload,
  ProjectSourceDocumentReference,
} from "@/types/project-flow";
import { parseQuotedAmount } from "@/utils/calculations";

import { canSeeProjectFinancials } from "../access/projects";
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
function noSourceDocument(
  kind: "tender" | "contract",
): ProjectSourceDocumentReference {
  return { fileId: "", fileName: "", kind, url: "" };
}

/**
 * The extracted requirements without their commercial section, without the
 * HBCF claim amounts (the insurance pool is counted from them), and without the
 * links to the tender and the contract, which carry the price in full. The
 * rest — wet areas, site safety, inclusions, the HBCF certificate itself — is
 * what a site manager builds from, and stays.
 */
export function hideRequirementsFinancials(
  requirements: ProjectRequirementsPayload | undefined,
): ProjectRequirementsPayload | undefined {
  if (!requirements) return requirements;
  const legal = requirements.legalAdministration;
  return {
    ...requirements,
    commercialsAndClaims: NO_COMMERCIALS,
    ...(requirements.sourceDocuments
      ? {
          sourceDocuments: {
            ...requirements.sourceDocuments,
            contract: noSourceDocument("contract"),
            tender: noSourceDocument("tender"),
          },
        }
      : {}),
    ...(legal && Array.isArray(legal.hbcfClaimDocuments)
      ? {
          legalAdministration: {
            ...legal,
            hbcfClaimDocuments: legal.hbcfClaimDocuments.map((document) => ({
              ...document,
              claimAmount: null,
            })),
          },
        }
      : {}),
  };
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
 * The activity-log entries whose message carries an amount: a tradie's quote, a
 * variation's price, an activity's quoted price or the office's tradie figures.
 * Dropped from a hidden detail because the text is the leak — there is no field
 * to zero.
 */
const MONEY_LOG_TYPES: ReadonlySet<string> = new Set([
  "milestonePriceChanged",
  "milestoneTradieFigureChanged",
  "tradieScheduleQuoted",
  "variationCreated",
  // No amount in the text, but the variation's description, which is where the
  // office writes what it costs; the variations themselves are hidden too.
  "variationUpdated",
]);

/** The whole detail payload: contract, claims, variations, quotes, costs. */
export function hideDetailProjectFinancials(
  project: ProjectDetail,
): ProjectDetail {
  return {
    ...project,
    activityLogs: project.activityLogs.filter(
      (entry) => !MONEY_LOG_TYPES.has(entry.type),
    ),
    financialsHidden: true,
    invoices: [],
    // The sales thread on the lead this project came from: it carries the
    // quotation and its price, and is the sales side's, not the build's.
    lead: { ...project.lead, emails: [] },
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
