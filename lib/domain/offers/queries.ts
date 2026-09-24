import { OfferStatus, Prisma } from "@prisma/client";

import { authorizeLead, leadListScope } from "../access/leads";
import { authorizeOffer } from "../access/offers";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { DomainPrincipal } from "../principal";
import type {
  OfferSignerStatus,
  OfferSignerStatusValue,
} from "@/lib/offer/signing-status";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { resolveOfferContractValue } from "@/lib/offer/offer-contract-value";

export const OFFER_SUMMARY_SELECT = {
  acceptedAt: true,
  amount: true,
  baseReference: true,
  contractValueIncGst: true,
  createdAt: true,
  gstAmount: true,
  id: true,
  isActive: true,
  leadId: true,
  offerStatus: true,
  revisionNumber: true,
  sentAt: true,
  stateVersion: true,
  totalAmount: true,
  updatedAt: true,
  workspaceState: true,
  lead: { select: { location: true, name: true } },
} as const;

export type OfferSummary = Prisma.OfferGetPayload<{
  select: typeof OFFER_SUMMARY_SELECT;
}>;

export async function searchOffers(
  principal: DomainPrincipal,
  input: { readonly limit: number; readonly query: string },
  db: DomainDb,
): Promise<OfferSummary[]> {
  const scope = leadListScope(principal);
  const query = input.query.trim();
  return db.offer.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    select: OFFER_SUMMARY_SELECT,
    take: input.limit,
    where: {
      lead: {
        ...(scope.assignedId === null ? {} : { assignedId: scope.assignedId }),
      },
      OR: [
        { id: query },
        { baseReference: { contains: query, mode: "insensitive" } },
        { lead: { name: { contains: query, mode: "insensitive" } } },
      ],
    },
  });
}

export async function getOfferSummary(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
): Promise<OfferSummary> {
  await authorizeOffer(principal, offerId, db, { allowInactive: true });
  const offer = await db.offer.findUnique({
    select: OFFER_SUMMARY_SELECT,
    where: { id: offerId },
  });
  if (!offer) throw new DomainNotFoundError("Offer not found.");
  return offer;
}

export async function listOfferRevisionSummaries(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly limit: number },
  db: DomainDb,
): Promise<OfferSummary[]> {
  await authorizeLead(principal, input.leadId, db);
  return db.offer.findMany({
    orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
    select: OFFER_SUMMARY_SELECT,
    take: input.limit,
    where: { leadId: input.leadId },
  });
}

export async function getOfferWorkspaceDetails(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
) {
  const offer = await getOfferSummary(principal, offerId, db);
  if (offer.workspaceState === null) {
    throw new DomainValidationError(
      "This offer has no saved workspace details yet.",
    );
  }
  return { offer, workspace: parseWorkspaceState(offer.workspaceState) };
}

const DECLINED_STATUSES: ReadonlySet<OfferStatus> = new Set([
  OfferStatus.OFFER_DECLINED,
  OfferStatus.TENDER_DECLINED,
  OfferStatus.CONTRACT_DECLINED,
]);

export async function getOfferSigningStatus(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
): Promise<{
  readonly status: OfferStatus;
  readonly stateVersion: number;
  readonly signerStatuses: OfferSignerStatus[];
  readonly declineReason: string | null;
}> {
  await authorizeOffer(principal, offerId, db, { allowInactive: true });
  const offer = await db.offer.findUnique({
    select: { offerStatus: true, stateVersion: true },
    where: { id: offerId },
  });
  if (!offer) throw new DomainNotFoundError("Offer not found.");

  const [envelopes, declineEvent] = await Promise.all([
    db.envelope.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        docType: true,
        signatures: {
          orderBy: { routingOrder: "asc" },
          select: {
            email: true,
            name: true,
            recipientRole: true,
            routingOrder: true,
            signedAt: true,
            status: true,
          },
        },
      },
      where: {
        OR: [{ offerId }, { tender: { offerId } }, { contract: { offerId } }],
      },
    }),
    DECLINED_STATUSES.has(offer.offerStatus)
      ? db.offerStatusEvent.findFirst({
          orderBy: { at: "desc" },
          select: { note: true },
          where: { offerId, toStatus: offer.offerStatus },
        })
      : null,
  ]);

  const seen = new Set<string>();
  const signerStatuses: OfferSignerStatus[] = [];
  for (const envelope of envelopes) {
    if (seen.has(envelope.docType)) continue;
    seen.add(envelope.docType);
    for (const signature of envelope.signatures) {
      signerStatuses.push({
        docType:
          envelope.docType === "TENDER" || envelope.docType === "CONTRACT"
            ? envelope.docType
            : "OFFER",
        email: signature.email,
        name: signature.name,
        role: signature.recipientRole === "BUILDER" ? "BUILDER" : "CUSTOMER",
        routingOrder: signature.routingOrder,
        signedAt: signature.signedAt?.toISOString() ?? null,
        status: signature.status as OfferSignerStatusValue,
      });
    }
  }
  return {
    declineReason: declineEvent?.note ?? null,
    signerStatuses,
    stateVersion: offer.stateVersion,
    status: offer.offerStatus,
  };
}

export type OfferRevisionSummary = {
  readonly offerId: string;
  readonly reference: string;
  readonly revisionNumber: number;
  readonly status: OfferStatus;
  readonly contractValueIncGst: number | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly tenderPdfUrl: string | null;
  readonly contractPdfUrl: string | null;
};

export async function listOfferRevisionHistory(
  principal: DomainPrincipal,
  leadId: number,
  db: DomainDb,
): Promise<readonly OfferRevisionSummary[]> {
  await authorizeLead(principal, leadId, db);
  const offers = await db.offer.findMany({
    orderBy: { revisionNumber: "desc" },
    select: {
      baseReference: true,
      contract: { select: { executedPdfUrl: true } },
      contractValueIncGst: true,
      createdAt: true,
      id: true,
      isActive: true,
      offerStatus: true,
      revisionNumber: true,
      tender: { select: { executedPdfUrl: true } },
    },
    where: { leadId },
  });
  const unpricedIds = offers
    .filter((offer) => Number(offer.contractValueIncGst ?? 0) <= 0)
    .map((offer) => offer.id);
  const stateById = new Map<string, Prisma.JsonValue | null>(
    unpricedIds.length === 0
      ? []
      : (
          await db.offer.findMany({
            select: { id: true, workspaceState: true },
            where: { id: { in: unpricedIds } },
          })
        ).map((offer) => [offer.id, offer.workspaceState]),
  );
  return offers.map((offer) => ({
    contractPdfUrl: offer.contract?.executedPdfUrl ?? null,
    contractValueIncGst: resolveOfferContractValue(
      offer.contractValueIncGst === null
        ? null
        : Number(offer.contractValueIncGst),
      stateById.get(offer.id) ?? null,
    ),
    createdAt: offer.createdAt.toISOString(),
    isActive: offer.isActive,
    offerId: offer.id,
    reference: offer.baseReference.trim()
      ? `${offer.baseReference}-R${offer.revisionNumber}`
      : `R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    tenderPdfUrl: offer.tender?.executedPdfUrl ?? null,
  }));
}

export type LoadedOfferRevision =
  | {
      readonly ok: true;
      readonly offerId: string;
      readonly reference: string;
      readonly revisionNumber: number;
      readonly status: OfferStatus;
      readonly isActive: boolean;
      readonly createdAt: string;
      readonly lastSentAt: string | null;
      readonly snapshot: OfferWorkspaceSnapshot;
    }
  | { readonly ok: false; readonly reason: "empty" | "unreadable" };

export async function loadOfferRevisionSnapshot(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
): Promise<LoadedOfferRevision> {
  await authorizeOffer(principal, offerId, db, { allowInactive: true });
  const offer = await db.offer.findUnique({
    select: {
      baseReference: true,
      createdAt: true,
      documentSends: {
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
        take: 1,
      },
      id: true,
      isActive: true,
      offerStatus: true,
      revisionNumber: true,
      workspaceState: true,
    },
    where: { id: offerId },
  });
  if (!offer) throw new DomainNotFoundError("Offer not found.");
  if (offer.workspaceState === null) return { ok: false, reason: "empty" };
  let snapshot: OfferWorkspaceSnapshot;
  try {
    snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return {
    createdAt: offer.createdAt.toISOString(),
    isActive: offer.isActive,
    lastSentAt: offer.documentSends[0]?.sentAt.toISOString() ?? null,
    offerId: offer.id,
    ok: true,
    reference: offer.baseReference.trim()
      ? `${offer.baseReference}-R${offer.revisionNumber}`
      : `R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    snapshot,
    status: offer.offerStatus,
  };
}
