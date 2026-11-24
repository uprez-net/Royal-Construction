import { OfferStatus, type Prisma } from "@prisma/client";
import type {
  SydneyDayRange,
  SydneyDayRangeInput,
} from "@/lib/dates/day-range";
import { resolveOfferContractValue } from "@/lib/offer/offer-contract-value";
import { leadListScope } from "../access/leads";
import type { DomainDb } from "../db";
import { resolveDayRange } from "../day-range";
import { isOfficePrincipal, type DomainPrincipal } from "../principal";
import {
  OFFER_AWAITING_RESPONSE_STATUSES,
  listOfferFollowUpAlerts,
  type OfferFollowUpState,
} from "./follow-ups";

/**
 * Out for a DocuSign signature. SENT is not here: it is an offer emailed to
 * negotiate, which nobody has been asked to sign. The office digest's "Out for
 * the client's signature" and the offer list below share it (#618).
 */
export const OFFER_AWAITING_SIGNATURE_STATUSES: readonly OfferStatus[] = [
  OfferStatus.OFFER_SENT,
  OfferStatus.TENDER_SENT,
  OfferStatus.CONTRACT_SENT,
];

/** The groups a brief asks for by name, mapped to statuses once. */
export const OFFER_LIST_GROUPS = {
  awaiting_client: OFFER_AWAITING_RESPONSE_STATUSES,
  awaiting_signature: OFFER_AWAITING_SIGNATURE_STATUSES,
} as const satisfies Record<string, readonly OfferStatus[]>;

export type OfferListGroup = keyof typeof OFFER_LIST_GROUPS;

export type OfficeOfferListItem = {
  readonly offerId: string;
  readonly leadId: number;
  readonly clientName: string;
  readonly projectAddress: string | null;
  readonly reference: string;
  readonly revisionNumber: number;
  readonly status: OfferStatus;
  readonly sentAt: Date | null;
  readonly updatedAt: Date;
  /** The follow-up rule's verdict, when the offer is waiting on the client. */
  readonly followUp: OfferFollowUpState | null;
  /** Contract value inc GST. Office callers only; null for anyone else. */
  readonly valueIncGst: number | null;
};

/**
 * The active offers a brief asks about, across the office (#618): by status
 * or named group, changed within a window, or due a follow-up.
 *
 * Every offer tool needed a lead or an offer reference, so "which offers are
 * out for signature?" or "what changed yesterday?" walked leads, and the brief
 * came back "Offer briefing evidence unavailable". The follow-up verdict is
 * `listOfferFollowUpAlerts`'s own, not a second reading of the 24-hour rule.
 * A price is a client's money: only an office caller gets it.
 */
export async function listOfficeOffers(
  principal: DomainPrincipal,
  input: {
    readonly statuses?: readonly OfferStatus[];
    readonly group?: OfferListGroup;
    /** Only offers whose record changed in this window of Sydney days. */
    readonly changed?: SydneyDayRangeInput;
    readonly followUpDue?: boolean;
    readonly limit: number;
  },
  db: DomainDb,
  now: Date = new Date(),
): Promise<{
  readonly changed: SydneyDayRange | null;
  readonly total: number;
  readonly offers: OfficeOfferListItem[];
}> {
  const scope = leadListScope(principal);
  const changed = input.changed ? resolveDayRange(input.changed, now) : null;
  const statuses = [
    ...(input.statuses ?? []),
    ...(input.group ? OFFER_LIST_GROUPS[input.group] : []),
  ];

  // Every offer is assessed only when the verdict decides who is listed;
  // otherwise just the rows the list returns are (below).
  const dueAlerts = input.followUpDue
    ? await listOfferFollowUpAlerts(principal, db, now)
    : null;
  const dueIds = (dueAlerts ?? [])
    .filter((alert) => alert.state === "DUE")
    .map((alert) => alert.offerId);

  const where: Prisma.OfferWhereInput = {
    isActive: true,
    lead: {
      isArchived: false,
      ...(scope.assignedId === null ? {} : { assignedId: scope.assignedId }),
    },
    ...(statuses.length ? { offerStatus: { in: statuses } } : {}),
    ...(changed ? { updatedAt: { gte: changed.from, lte: changed.to } } : {}),
    ...(input.followUpDue ? { id: { in: dueIds } } : {}),
  };
  const office = isOfficePrincipal(principal);
  const [total, rows] = await Promise.all([
    db.offer.count({ where }),
    db.offer.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        baseReference: true,
        contractValueIncGst: true,
        id: true,
        lead: { select: { location: true, name: true } },
        leadId: true,
        offerStatus: true,
        revisionNumber: true,
        sentAt: true,
        updatedAt: true,
        workspaceState: office,
      },
      take: input.limit,
      where,
    }),
  ]);

  const alerts =
    dueAlerts
    ?? (rows.length
      ? await listOfferFollowUpAlerts(principal, db, now, {
          offerIds: rows.map((row) => row.id),
        })
      : []);
  const followUps = new Map(
    alerts.map((alert) => [alert.offerId, alert.state]),
  );

  return {
    changed,
    offers: rows.map((row) => ({
      clientName: row.lead.name,
      followUp: followUps.get(row.id) ?? null,
      leadId: row.leadId,
      offerId: row.id,
      projectAddress: row.lead.location,
      reference: `${row.baseReference.trim() || `OF-${row.leadId}`}-R${row.revisionNumber}`,
      revisionNumber: row.revisionNumber,
      sentAt: row.sentAt,
      status: row.offerStatus,
      updatedAt: row.updatedAt,
      valueIncGst: office
        ? resolveOfferContractValue(
            row.contractValueIncGst === null
              ? null
              : Number(row.contractValueIncGst),
            row.workspaceState,
          )
        : null,
    })),
    total,
  };
}
