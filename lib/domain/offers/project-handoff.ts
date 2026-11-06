import { OfferStatus } from "@prisma/client";

import { authorizeOffer } from "../access/offers";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../errors";
import { syncLeadStageForOffer } from "../leads/stage-sync";
import { attributionUserId, type DomainPrincipal } from "../principal";

export async function prepareProjectHandoff(
  principal: DomainPrincipal,
  offerId: string,
  db: DomainDb,
) {
  await authorizeOffer(principal, offerId, db);
  const offer = await db.offer.findUnique({
    select: {
      agreedSnapshot: true,
      baseReference: true,
      contract: {
        select: {
          documentData: true,
          envelopes: {
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            select: { docusignId: true, status: true },
            take: 1,
          },
          executedPdfUrl: true,
          id: true,
        },
      },
      id: true,
      lead: {
        select: {
          email: true,
          id: true,
          name: true,
          phone: true,
          project: { select: { id: true } },
        },
      },
      leadId: true,
      offerStatus: true,
      revisionNumber: true,
      tender: {
        select: {
          documentData: true,
          envelopes: {
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            select: { docusignId: true, status: true },
            take: 1,
          },
          executedPdfUrl: true,
          id: true,
        },
      },
      workspaceState: true,
    },
    where: { id: offerId },
  });
  if (!offer?.lead)
    throw new DomainNotFoundError("Offer or its lead not found.");
  if (offer.offerStatus === OfferStatus.PROJECT) {
    throw new DomainTransitionError(
      "A project has already been created from this offer.",
    );
  }
  if (offer.offerStatus !== OfferStatus.CONTRACT_SIGNED) {
    throw new DomainTransitionError(
      `The project can only be created once the Contract is signed (current status: ${offer.offerStatus}).`,
    );
  }
  if (offer.lead.project) {
    throw new DomainTransitionError(
      `Lead #${offer.lead.id} already has a project (${offer.lead.project.id}).`,
    );
  }
  const state = offer.agreedSnapshot ?? offer.workspaceState;
  if (!state)
    throw new DomainTransitionError("No agreed offer snapshot found.");
  return { offer, state };
}

export async function claimProjectHandoff(
  offerId: string,
  db: TransactionalDomainDb,
): Promise<boolean> {
  const claim = await db.offer.updateMany({
    data: { offerStatus: OfferStatus.PROJECT },
    where: { id: offerId, offerStatus: OfferStatus.CONTRACT_SIGNED },
  });
  if (claim.count === 1) await syncLeadStageForOffer(offerId, db);
  return claim.count === 1;
}

export async function revertProjectHandoffClaim(
  offerId: string,
  db: DomainDb,
): Promise<void> {
  await db.offer.updateMany({
    data: { offerStatus: OfferStatus.CONTRACT_SIGNED },
    where: { id: offerId, offerStatus: OfferStatus.PROJECT },
  });
}

export async function setHandoffLeadEmail(
  leadId: number,
  email: string,
  db: DomainDb,
): Promise<void> {
  await db.lead.update({ data: { email }, where: { id: leadId } });
}

export async function createHandoffFile(
  principal: DomainPrincipal,
  input: {
    readonly fileName: string;
    readonly leadId: number;
    readonly url: string;
    /** Which executed document it is, for its tags. */
    readonly kind?: "tender" | "contract";
  },
  db: DomainDb,
) {
  const actorId = attributionUserId(principal);
  if (!actorId) {
    throw new DomainAuthorizationError(
      "A signed-in user is required to attach project documents.",
    );
  }
  return db.file.create({
    data: {
      fileType: "application/pdf",
      filename: input.fileName,
      filesize: 0,
      leadId: input.leadId,
      uploadedBy: actorId,
      url: input.url,
      tags: [
        "Offer",
        "Signed",
        ...(input.kind === "tender" ? ["Tender"] : []),
        ...(input.kind === "contract" ? ["Contract"] : []),
      ],
      origin: "Offer › Project handoff",
    },
  });
}

export async function deleteHandoffFiles(
  ids: readonly string[],
  db: DomainDb,
): Promise<void> {
  if (ids.length === 0) return;
  await db.file.deleteMany({ where: { id: { in: [...ids] } } });
}

export async function findCommittedHandoffProject(
  leadId: number,
  db: DomainDb,
) {
  return db.lead.findUnique({
    select: { project: { select: { id: true, name: true } } },
    where: { id: leadId },
  });
}

export async function recordProjectHandoff(
  principal: DomainPrincipal,
  input: { readonly offerId: string; readonly projectId: string },
  db: DomainDb,
): Promise<void> {
  try {
    await db.offerStatusEvent.create({
      data: {
        actorId: attributionUserId(principal),
        fromStatus: OfferStatus.CONTRACT_SIGNED,
        note: `Project ${input.projectId} created from executed contract`,
        offerId: input.offerId,
        toStatus: OfferStatus.PROJECT,
      },
    });
  } catch (error) {
    console.error("[offer] handoff audit event failed:", error);
  }
}
