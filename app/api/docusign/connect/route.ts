import { NextResponse } from "next/server";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { revalidateTag } from "next/cache";
import { put } from "@vercel/blob";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Role,
  SignerStatus,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { verifyConnectSignature } from "@/lib/docusign/connect-signature";
import { downloadCombinedDocument } from "@/lib/docusign/tender-envelope";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "@/lib/notification/novu";

// DocuSign Connect (JSON SIM) webhook: keeps Envelope + EnvelopeSignature in
// step with signing progress, and on completion archives the executed PDF and
// advances the offer (TENDER_SENT → TENDER_SIGNED / CONTRACT_SENT →
// CONTRACT_SIGNED). Always answers 200 for events we don't track so DocuSign
// doesn't retry them forever.
export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();

  const hmacKey = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
  if (hmacKey) {
    // DocuSign supports SEVERAL concurrent Connect HMAC keys — that is how a key
    // is rotated without downtime — and signs each delivery with EVERY active
    // key, emitting one header per key: x-docusign-signature-1, -2, -3…
    // Checking only `-1` therefore breaks the moment a second key is added: the
    // header we read is signed with the OLD key while the env var holds the NEW
    // one, so every callback 401s (observed on staging, PR #124 follow-up). The
    // payload is authentic if it matches ANY of the presented signatures.
    if (!verifyConnectSignature(request.headers, raw, hmacKey)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[docusign] Connect webhook received without DOCUSIGN_CONNECT_HMAC_KEY configured — rejecting.",
    );
    return NextResponse.json({ error: "HMAC not configured" }, { status: 401 });
  }

  let payload: ConnectPayload;
  try {
    payload = JSON.parse(raw) as ConnectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload.event;
  const docusignId = payload.data?.envelopeId;
  if (!event || !docusignId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const envelope = await prisma.envelope.findUnique({
    where: { docusignId },
    include: {
      signatures: true,
      tender: { select: { id: true, offerId: true, executedPdfUrl: true } },
      contract: { select: { id: true, offerId: true, executedPdfUrl: true } },
      // An OFFER-type acceptance envelope hangs directly off the Offer (ADR 0004).
      offer: { select: { id: true, executedPdfUrl: true } },
    },
  });
  if (!envelope) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await syncRecipients(envelope.id, envelope.signatures, payload);
    await syncEnvelopeStatus(envelope, event, payload);
  } catch (error) {
    console.error("[docusign] Connect processing failed:", error);
    // 500 → DocuSign retries with backoff, which is what we want here.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  // This webhook advances offer status (TENDER_SENT → TENDER_SIGNED, etc.) and
  // per-signer state, but nothing invalidated the caches keyed on the offer —
  // every other writer (send/sign actions) does. Cached surfaces could therefore
  // keep serving a pre-signature view. Best-effort: the work is already
  // committed, so a revalidation failure must not turn into a 500 and make
  // DocuSign redeliver an event we have applied.
  const offerId =
    envelope.tender?.offerId ?? envelope.contract?.offerId ?? envelope.offer?.id;
  if (offerId) {
    try {
      revalidateTag(`offer-${offerId}`, CACHE_PROFILES.SHORT);
    } catch (error) {
      console.error("[docusign] revalidate after Connect sync failed:", error);
    }
  }

  return NextResponse.json({ ok: true });
}

type ConnectRecipient = {
  recipientId?: string;
  email?: string;
  routingOrder?: string;
  status?: string;
  signedDateTime?: string;
  declinedReason?: string;
};

type ConnectPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      recipients?: { signers?: ConnectRecipient[] };
    };
  };
};


const RECIPIENT_STATUS: Record<string, SignerStatus> = {
  sent: SignerStatus.SENT,
  delivered: SignerStatus.DELIVERED,
  completed: SignerStatus.SIGNED,
  signed: SignerStatus.SIGNED,
  declined: SignerStatus.DECLINED,
};

async function syncRecipients(
  envelopeId: string,
  signatures: readonly {
    id: string;
    docusignRecipientId: string | null;
    email: string;
    routingOrder: number;
  }[],
  payload: ConnectPayload,
): Promise<void> {
  const signers = payload.data?.envelopeSummary?.recipients?.signers ?? [];
  for (const signer of signers) {
    const status = RECIPIENT_STATUS[(signer.status ?? "").toLowerCase()];
    if (!status) {
      continue;
    }
    const match =
      signatures.find(
        (s) =>
          s.docusignRecipientId !== null &&
          s.docusignRecipientId === signer.recipientId,
      ) ??
      signatures.find(
        (s) => s.email.toLowerCase() === (signer.email ?? "").toLowerCase(),
      );
    if (!match) {
      continue;
    }
    await prisma.envelopeSignature.update({
      where: { id: match.id },
      data: {
        status,
        ...(status === SignerStatus.SIGNED
          ? {
              signedAt: signer.signedDateTime
                ? new Date(signer.signedDateTime)
                : new Date(),
            }
          : {}),
      },
    });
  }
}

const ENVELOPE_STATUS: Record<string, EnvelopeStatus> = {
  "envelope-sent": EnvelopeStatus.SENT,
  "envelope-delivered": EnvelopeStatus.DELIVERED,
  "envelope-completed": EnvelopeStatus.COMPLETED,
  "envelope-declined": EnvelopeStatus.DECLINED,
  "envelope-voided": EnvelopeStatus.VOIDED,
};

// Monotonic rank for forward-only status: an out-of-order or replayed event
// must never drag a terminal envelope (COMPLETED/DECLINED/VOIDED) backwards.
function envelopeStatusRank(status: EnvelopeStatus): number {
  switch (status) {
    case EnvelopeStatus.SENT:
      return 1;
    case EnvelopeStatus.DELIVERED:
      return 2;
    case EnvelopeStatus.COMPLETED:
    case EnvelopeStatus.DECLINED:
    case EnvelopeStatus.VOIDED:
      return 3;
    default:
      return 0;
  }
}

// The envelope shape the webhook loads. An envelope hangs off exactly one parent:
// a Tender, a Contract, or — for an OFFER-type acceptance (ADR 0004) — the Offer
// directly.
type ConnectEnvelope = {
  id: string;
  docusignId: string | null;
  docType: EnvelopeDocType;
  status: EnvelopeStatus;
  tender: { id: string; offerId: string; executedPdfUrl: string | null } | null;
  contract: { id: string; offerId: string; executedPdfUrl: string | null } | null;
  offer: { id: string; executedPdfUrl: string | null } | null;
};

// Everything the completion/decline paths need to treat an envelope's parent
// uniformly: which Offer it belongs to, where the executed PDF is archived, and
// which offer-status a completion / decline advances to.
type EnvelopeTarget = {
  offerId: string;
  executedPdfUrl: string | null;
  archivePrefix: "tender" | "contract" | "offer";
  signedStatus: OfferStatus;
  declinedStatus: OfferStatus;
  expectedFromStatus: OfferStatus;
  writeExecutedPdf: (url: string) => Promise<unknown>;
  // Only a fully-executed Contract nudges the admins to create the project.
  notifyContractSigned: boolean;
  // Matches this envelope's siblings, so a decline only moves the offer when it
  // is the CURRENT (latest-sent) envelope for the document.
  siblingEnvelopeWhere:
    | { tenderId: string }
    | { contractId: string }
    | { offerId: string };
};

function resolveEnvelopeTarget(envelope: ConnectEnvelope): EnvelopeTarget | null {
  switch (envelope.docType) {
    case EnvelopeDocType.TENDER:
      if (!envelope.tender) return null;
      return {
        offerId: envelope.tender.offerId,
        executedPdfUrl: envelope.tender.executedPdfUrl,
        archivePrefix: "tender",
        signedStatus: OfferStatus.TENDER_SIGNED,
        declinedStatus: OfferStatus.TENDER_DECLINED,
        expectedFromStatus: OfferStatus.TENDER_SENT,
        writeExecutedPdf: (url) =>
          prisma.tender.update({
            where: { id: envelope.tender!.id },
            data: { executedPdfUrl: url },
          }),
        notifyContractSigned: false,
        siblingEnvelopeWhere: { tenderId: envelope.tender.id },
      };
    case EnvelopeDocType.CONTRACT:
      if (!envelope.contract) return null;
      return {
        offerId: envelope.contract.offerId,
        executedPdfUrl: envelope.contract.executedPdfUrl,
        archivePrefix: "contract",
        signedStatus: OfferStatus.CONTRACT_SIGNED,
        declinedStatus: OfferStatus.CONTRACT_DECLINED,
        expectedFromStatus: OfferStatus.CONTRACT_SENT,
        writeExecutedPdf: (url) =>
          prisma.contract.update({
            where: { id: envelope.contract!.id },
            data: { executedPdfUrl: url },
          }),
        notifyContractSigned: true,
        siblingEnvelopeWhere: { contractId: envelope.contract.id },
      };
    case EnvelopeDocType.OFFER:
      // Offer-acceptance envelope (ADR 0004): the parent IS the Offer, so the
      // executed PDF is archived onto Offer.executedPdfUrl and completion advances
      // OFFER_SENT → OFFER_SIGNED (customer accepted). No admin nudge — the
      // estimator then marks the offer agreed to generate the Tender.
      if (!envelope.offer) return null;
      return {
        offerId: envelope.offer.id,
        executedPdfUrl: envelope.offer.executedPdfUrl,
        archivePrefix: "offer",
        signedStatus: OfferStatus.OFFER_SIGNED,
        declinedStatus: OfferStatus.OFFER_DECLINED,
        expectedFromStatus: OfferStatus.OFFER_SENT,
        writeExecutedPdf: (url) =>
          prisma.offer.update({
            where: { id: envelope.offer!.id },
            data: { executedPdfUrl: url },
          }),
        notifyContractSigned: false,
        siblingEnvelopeWhere: { offerId: envelope.offer.id },
      };
    default:
      return null;
  }
}

async function syncEnvelopeStatus(
  envelope: ConnectEnvelope,
  event: string,
  payload: ConnectPayload,
): Promise<void> {
  const nextStatus = ENVELOPE_STATUS[event];
  if (!nextStatus) {
    return;
  }

  // Forward-only: advance the envelope status only on a strictly higher rank so
  // a replayed/out-of-order event can't regress it (e.g. a late "sent" after
  // "completed").
  if (envelopeStatusRank(nextStatus) > envelopeStatusRank(envelope.status)) {
    const now = new Date();
    await prisma.envelope.update({
      where: { id: envelope.id },
      data: {
        status: nextStatus,
        ...(nextStatus === EnvelopeStatus.COMPLETED ? { completedAt: now } : {}),
        ...(nextStatus === EnvelopeStatus.VOIDED ? { voidedAt: now } : {}),
      },
    });
  }

  // A customer decline moves the offer to a revise-ready stage; it never
  // advances to the signed state, so branch off before the completion path.
  if (nextStatus === EnvelopeStatus.DECLINED) {
    await advanceOfferOnDecline(envelope, payload);
    return;
  }

  if (nextStatus !== EnvelopeStatus.COMPLETED) {
    return;
  }

  const target = resolveEnvelopeTarget(envelope);
  if (!target) {
    return;
  }

  const latestEnvelope = await prisma.envelope.findFirst({
    where: target.siblingEnvelopeWhere,
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!latestEnvelope || latestEnvelope.id !== envelope.id) {
    return;
  }

  // The completion side-effects below run on EVERY completion event (not just
  // the first), each guarded to be idempotent, so a retry after a mid-way
  // failure still advances the offer instead of short-circuiting on the
  // already-COMPLETED envelope. Archive only if not already archived — a
  // download failure must not block the offer advance (DocuSign retains it).
  if (envelope.docusignId && !target.executedPdfUrl) {
    try {
      const context = await createDocusignContext(getDocusignConfig());
      const executed = await downloadCombinedDocument(
        context,
        envelope.docusignId,
      );
      const blob = await put(
        `offer-signed/${target.archivePrefix}-${envelope.docusignId}.pdf`,
        executed,
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/pdf",
        },
      );
      await target.writeExecutedPdf(blob.url);
    } catch (error) {
      console.error("[docusign] Failed to archive executed PDF:", error);
    }
  }

  // Forward-only: transition solely from the matching SENT state so a
  // replayed completion event can't drag an offer that has already moved on
  // (e.g. to PROJECT, or past OFFER_SIGNED to AGREED) back to the signed state.
  const offer = await prisma.offer.findUnique({
    where: { id: target.offerId },
    select: {
      id: true,
      offerStatus: true,
      baseReference: true,
      revisionNumber: true,
      leadId: true,
      agreedSnapshot: true,
      workspaceState: true,
      // stage, because the lead-stage sync below must compare against the
      // value read in this same request — reading it separately reintroduces
      // the read-then-write race the compare-and-swap exists to prevent.
      lead: { select: { name: true, stage: true } },
    },
  });
  if (offer && offer.offerStatus === target.expectedFromStatus) {
    const claimed = await prisma.$transaction(async (tx) => {
      const latest = await tx.envelope.findFirst({
        where: target.siblingEnvelopeWhere,
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });
      if (!latest || latest.id !== envelope.id) {
        return false;
      }
      const updated = await tx.offer.updateMany({
        where: {
          id: offer.id,
          isActive: true,
          offerStatus: target.expectedFromStatus,
        },
        data: { offerStatus: target.signedStatus },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: target.expectedFromStatus,
          toStatus: target.signedStatus,
          note: `DocuSign envelope ${envelope.docusignId} completed`,
        },
      });
      // Placed AFTER the count check, so it runs only for the caller that won
      // the compare-and-swap, and inside the transaction so the lead moves
      // with the status. It never throws — a signature must not be lost
      // because a reporting field failed to update, and this handler answers
      // 500 on a throw specifically to make DocuSign retry.
      await syncLeadStageForOffer({
        client: tx,
        leadId: offer.leadId,
        offerStatus: target.signedStatus,
        currentStage: offer.lead?.stage ?? null,
      });
      return true;
    });

    // Contract fully executed → nudge the admins to create the project.
    // Project creation stays a deliberate click (kickoff dates, site manager,
    // and booking warnings need a human), so the nudge is the automation.
    if (claimed && target.notifyContractSigned) {
      try {
        const admins = await prisma.user.findMany({
          where: { role: Role.ADMIN },
          select: { id: true },
        });
        const snapshot = (offer.agreedSnapshot ?? offer.workspaceState) as {
          job?: { siteAddress?: string; clientNames?: string };
        } | null;
        await triggerNotification(
          admins.map((admin) => admin.id),
          createNotification("contractSigned", {
            leadId: String(offer.leadId),
            offerReference: `${offer.baseReference}-R${offer.revisionNumber}`,
            customerName: snapshot?.job?.clientNames || offer.lead?.name || "the client",
            siteAddress: snapshot?.job?.siteAddress ?? "",
          }),
        );
      } catch (error) {
        // The nudge must never fail the webhook — DocuSign would retry the
        // whole event and re-run the status transition path.
        console.error("[docusign] contract-signed notification failed:", error);
      }
    }
  }
}

// A decline (envelope-declined) moves the offer to a revise-ready stage —
// OFFER_DECLINED / TENDER_DECLINED / CONTRACT_DECLINED — and records DocuSign's
// decline reason on the status event, so the operator sees why and can revise and
// re-issue via a new revision (issue #89, ADR 0004).
async function advanceOfferOnDecline(
  envelope: ConnectEnvelope,
  payload: ConnectPayload,
): Promise<void> {
  const target = resolveEnvelopeTarget(envelope);
  if (!target) {
    return;
  }

  // DocuSign attaches the decliner's reason to the recipient record; surface it
  // rather than inventing our own copy.
  const declineReason = (payload.data?.envelopeSummary?.recipients?.signers ?? [])
    .find((signer) => (signer.status ?? "").toLowerCase() === "declined")
    ?.declinedReason?.trim();

  // Atomic claim: only the delivery that flips *_SENT -> *_DECLINED records the
  // event, so concurrent duplicate webhooks can't write duplicate audit rows,
  // and a replayed decline (or an offer that already advanced) is a no-op.
  await prisma.$transaction(async (tx) => {
    const latest = await tx.envelope.findFirst({
      where: target.siblingEnvelopeWhere,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!latest || latest.id !== envelope.id) {
      return;
    }
    const claim = await tx.offer.updateMany({
      where: {
        id: target.offerId,
        isActive: true,
        offerStatus: target.expectedFromStatus,
      },
      data: { offerStatus: target.declinedStatus },
    });
    if (claim.count === 0) {
      return;
    }
    await tx.offerStatusEvent.create({
      data: {
        offerId: target.offerId,
        fromStatus: target.expectedFromStatus,
        toStatus: target.declinedStatus,
        note: declineReason
          ? `Declined via DocuSign: ${declineReason}`
          : "Declined via DocuSign.",
      },
    });
  });
}
