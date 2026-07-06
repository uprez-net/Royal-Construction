"use server";

import { OfferStatus, Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  serializeWorkspace,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";

// The active offer for a lead, ready to hydrate the workspace. `snapshot` is
// null when the offer has no saved working-state yet (client uses defaults).
type LoadedOfferWorkspace = {
  offerId: string;
  reference: string;
  revisionNumber: number;
  status: OfferStatus;
  stateVersion: number;
  snapshot: OfferWorkspaceSnapshot | null;
};

type OfferRow = {
  id: string;
  baseReference: string;
  revisionNumber: number;
  offerStatus: OfferStatus;
  stateVersion: number;
  workspaceState: Prisma.JsonValue | null;
};

function toLoaded(offer: OfferRow): LoadedOfferWorkspace {
  const snapshot =
    offer.workspaceState === null
      ? null
      : deserializeWorkspace(parseWorkspaceState(offer.workspaceState));
  return {
    offerId: offer.id,
    reference: `${offer.baseReference}-R${offer.revisionNumber}`,
    revisionNumber: offer.revisionNumber,
    status: offer.offerStatus,
    stateVersion: offer.stateVersion,
    snapshot,
  };
}

// Mint the next base reference (RC-Q-YYYY-NNN) inside a transaction.
async function mintOfferReference(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.offerReferenceCounter.upsert({
    where: { year },
    create: { year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  return `RC-Q-${year}-${String(counter.lastSeq).padStart(3, "0")}`;
}

export async function loadActiveOfferWorkspace(
  leadId: number,
  actorId?: string,
): Promise<LoadedOfferWorkspace> {
  const existing = await prisma.offer.findFirst({
    where: { leadId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return toLoaded(existing);
  }

  // First offer for this lead — create it with a freshly minted reference.
  const created = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const baseReference = await mintOfferReference(tx, year);
    return tx.offer.create({
      data: {
        leadId,
        baseReference,
        revisionNumber: 1,
        isActive: true,
        createdById: actorId,
        offerStatus: OfferStatus.PENDING,
        amount: new Prisma.Decimal(0),
        gstAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
      },
    });
  });
  revalidateTag(`offer-lead-${leadId}`, CACHE_PROFILES.SHORT);
  return toLoaded(created);
}

type SaveResult =
  | { ok: true; stateVersion: number }
  | { ok: false; reason: "stale"; currentStateVersion: number | null };

// Debounced autosave with optimistic concurrency (ADR 0002): the write only
// lands if the caller's stateVersion still matches; otherwise it is rejected so
// the client can reload rather than silently clobber a newer save.
export async function saveOfferWorkspace(input: {
  offerId: string;
  expectedStateVersion: number;
  snapshot: OfferWorkspaceSnapshot;
}): Promise<SaveResult> {
  const persisted = serializeWorkspace(input.snapshot);
  const contractValue = new Prisma.Decimal(persisted.selectedPriceCents).div(
    100,
  );

  const result = await prisma.offer.updateMany({
    where: { id: input.offerId, stateVersion: input.expectedStateVersion },
    data: {
      workspaceState: persisted as unknown as Prisma.InputJsonValue,
      contractValueIncGst: contractValue,
      stateVersion: { increment: 1 },
    },
  });

  if (result.count === 0) {
    const current = await prisma.offer.findUnique({
      where: { id: input.offerId },
      select: { stateVersion: true },
    });
    return {
      ok: false,
      reason: "stale",
      currentStateVersion: current?.stateVersion ?? null,
    };
  }

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true, stateVersion: input.expectedStateVersion + 1 };
}

// Persist a lifecycle transition, record an audit event, and freeze the agreed
// snapshot on AGREED / stamp sentAt on SENT.
export async function transitionOfferStatus(input: {
  offerId: string;
  toStatus: OfferStatus;
  actorId?: string;
  note?: string;
}): Promise<{ ok: true; status: OfferStatus }> {
  await prisma.$transaction(async (tx) => {
    const offer = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
      select: { offerStatus: true, workspaceState: true },
    });

    const freezeAgreed =
      input.toStatus === OfferStatus.AGREED && offer.workspaceState !== null;

    await tx.offer.update({
      where: { id: input.offerId },
      data: {
        offerStatus: input.toStatus,
        ...(input.toStatus === OfferStatus.SENT ? { sentAt: new Date() } : {}),
        ...(freezeAgreed
          ? {
              agreedSnapshot: offer.workspaceState as Prisma.InputJsonValue,
              acceptedAt: new Date(),
            }
          : {}),
      },
    });

    await tx.offerStatusEvent.create({
      data: {
        offerId: input.offerId,
        fromStatus: offer.offerStatus,
        toStatus: input.toStatus,
        actorId: input.actorId,
        note: input.note,
      },
    });
  });

  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true, status: input.toStatus };
}

// Fork a new active revision from the current one, superseding it. The current
// row is deactivated first so the one-active-per-lead partial index holds.
export async function createOfferRevision(input: {
  offerId: string;
  actorId?: string;
}): Promise<{ ok: true; offerId: string; leadId: number }> {
  const created = await prisma.$transaction(async (tx) => {
    const current = await tx.offer.findUniqueOrThrow({
      where: { id: input.offerId },
    });

    await tx.offer.update({
      where: { id: current.id },
      data: { isActive: false, offerStatus: OfferStatus.SUPERSEDED },
    });

    const next = await tx.offer.create({
      data: {
        leadId: current.leadId,
        baseReference: current.baseReference,
        revisionNumber: current.revisionNumber + 1,
        isActive: true,
        createdById: input.actorId,
        offerStatus: OfferStatus.PENDING,
        amount: current.amount,
        gstAmount: current.gstAmount,
        totalAmount: current.totalAmount,
        contractValueIncGst: current.contractValueIncGst,
        workspaceState:
          current.workspaceState === null
            ? Prisma.JsonNull
            : (current.workspaceState as Prisma.InputJsonValue),
      },
    });

    await tx.offer.update({
      where: { id: current.id },
      data: { supersededById: next.id },
    });

    return next;
  });

  revalidateTag(`offer-lead-${created.leadId}`, CACHE_PROFILES.SHORT);
  return { ok: true, offerId: created.id, leadId: created.leadId };
}
