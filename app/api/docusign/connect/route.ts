import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { put } from "@vercel/blob";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Role,
  SignerStatus,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
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
    const signature = request.headers.get("x-docusign-signature-1");
    if (!signature || !verifyHmac(raw, hmacKey, signature)) {
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

function verifyHmac(raw: string, key: string, signature: string): boolean {
  const computed = createHmac("sha256", key).update(raw, "utf8").digest("base64");
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

async function syncEnvelopeStatus(
  envelope: {
    id: string;
    docusignId: string | null;
    docType: EnvelopeDocType;
    status: EnvelopeStatus;
    tender: { id: string; offerId: string; executedPdfUrl: string | null } | null;
    contract: {
      id: string;
      offerId: string;
      executedPdfUrl: string | null;
    } | null;
  },
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

  const isTender = envelope.docType === EnvelopeDocType.TENDER;
  const parent = isTender ? envelope.tender : envelope.contract;
  if (!parent) {
    return;
  }

  // The completion side-effects below run on EVERY completion event (not just
  // the first), each guarded to be idempotent, so a retry after a mid-way
  // failure still advances the offer instead of short-circuiting on the
  // already-COMPLETED envelope. Archive only if not already archived — a
  // download failure must not block the offer advance (DocuSign retains it).
  if (envelope.docusignId && !parent.executedPdfUrl) {
    try {
      const context = await createDocusignContext(getDocusignConfig());
      const executed = await downloadCombinedDocument(
        context,
        envelope.docusignId,
      );
      const blob = await put(
        `offer-signed/${isTender ? "tender" : "contract"}-${envelope.docusignId}.pdf`,
        executed,
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/pdf",
        },
      );
      if (isTender) {
        await prisma.tender.update({
          where: { id: parent.id },
          data: { executedPdfUrl: blob.url },
        });
      } else {
        await prisma.contract.update({
          where: { id: parent.id },
          data: { executedPdfUrl: blob.url },
        });
      }
    } catch (error) {
      console.error("[docusign] Failed to archive executed PDF:", error);
    }
  }

  const signedStatus = isTender
    ? OfferStatus.TENDER_SIGNED
    : OfferStatus.CONTRACT_SIGNED;
  // Forward-only: transition solely from the matching SENT state so a
  // replayed completion event can't drag an offer that has already moved on
  // (e.g. to PROJECT) back to the signed state.
  const expectedFromStatus = isTender
    ? OfferStatus.TENDER_SENT
    : OfferStatus.CONTRACT_SENT;
  const offer = await prisma.offer.findUnique({
    where: { id: parent.offerId },
    select: {
      id: true,
      offerStatus: true,
      baseReference: true,
      revisionNumber: true,
      leadId: true,
      agreedSnapshot: true,
      workspaceState: true,
      lead: { select: { name: true } },
    },
  });
  if (offer && offer.offerStatus === expectedFromStatus) {
    await prisma.$transaction([
      prisma.offer.update({
        where: { id: offer.id },
        data: { offerStatus: signedStatus },
      }),
      prisma.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: signedStatus,
          note: `DocuSign envelope ${envelope.docusignId} completed`,
        },
      }),
    ]);

    // Contract fully executed → nudge the admins to create the project.
    // Project creation stays a deliberate click (kickoff dates, site manager,
    // and booking warnings need a human), so the nudge is the automation.
    if (!isTender) {
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
// TENDER_DECLINED / CONTRACT_DECLINED — and records DocuSign's decline reason on
// the status event, so the operator sees why and can revise and re-issue via a
// new revision (issue #89).
async function advanceOfferOnDecline(
  envelope: {
    id: string;
    docType: EnvelopeDocType;
    tender: { id: string; offerId: string } | null;
    contract: { id: string; offerId: string } | null;
  },
  payload: ConnectPayload,
): Promise<void> {
  const isTender = envelope.docType === EnvelopeDocType.TENDER;
  const parent = isTender ? envelope.tender : envelope.contract;
  if (!parent) {
    return;
  }

  // Only the offer's CURRENT envelope may move the offer. A tender/contract can
  // carry more than one envelope — a recall-then-resend leaves the prior one
  // live in DocuSign — so a decline on a superseded envelope must be ignored at
  // the offer level; otherwise a genuinely-signed re-send is stranded in
  // *_DECLINED. Compare against the most-recently-sent envelope for this parent.
  const latest = await prisma.envelope.findFirst({
    where: isTender ? { tenderId: parent.id } : { contractId: parent.id },
    orderBy: { sentAt: "desc" },
    select: { id: true },
  });
  if (!latest || latest.id !== envelope.id) {
    return;
  }

  const declinedStatus = isTender
    ? OfferStatus.TENDER_DECLINED
    : OfferStatus.CONTRACT_DECLINED;
  const expectedFromStatus = isTender
    ? OfferStatus.TENDER_SENT
    : OfferStatus.CONTRACT_SENT;

  // DocuSign attaches the decliner's reason to the recipient record; surface it
  // rather than inventing our own copy. Role-neutral wording: after the tender
  // flip the builder is routingOrder 2 and can also decline.
  const declineReason = (payload.data?.envelopeSummary?.recipients?.signers ?? [])
    .find((signer) => (signer.status ?? "").toLowerCase() === "declined")
    ?.declinedReason?.trim();

  // Atomic claim: only the delivery that flips *_SENT -> *_DECLINED records the
  // event, so concurrent duplicate webhooks can't write duplicate audit rows,
  // and a replayed decline (or an offer that already advanced) is a no-op.
  const claim = await prisma.offer.updateMany({
    where: { id: parent.offerId, offerStatus: expectedFromStatus },
    data: { offerStatus: declinedStatus },
  });
  if (claim.count === 0) {
    return;
  }

  await prisma.offerStatusEvent.create({
    data: {
      offerId: parent.offerId,
      fromStatus: expectedFromStatus,
      toStatus: declinedStatus,
      note: declineReason
        ? `Declined via DocuSign: ${declineReason}`
        : "Declined via DocuSign.",
    },
  });
}
