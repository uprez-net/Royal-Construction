import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { put } from "@vercel/blob";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  SignerStatus,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { downloadCombinedDocument } from "@/lib/docusign/tender-envelope";

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
      tender: { select: { id: true, offerId: true } },
      contract: { select: { id: true, offerId: true } },
    },
  });
  if (!envelope) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await syncRecipients(envelope.id, envelope.signatures, payload);
    await syncEnvelopeStatus(envelope, event);
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

async function syncEnvelopeStatus(
  envelope: {
    id: string;
    docusignId: string | null;
    docType: EnvelopeDocType;
    status: EnvelopeStatus;
    tender: { id: string; offerId: string } | null;
    contract: { id: string; offerId: string } | null;
  },
  event: string,
): Promise<void> {
  const nextStatus = ENVELOPE_STATUS[event];
  if (!nextStatus || nextStatus === envelope.status) {
    return;
  }

  const now = new Date();
  await prisma.envelope.update({
    where: { id: envelope.id },
    data: {
      status: nextStatus,
      ...(nextStatus === EnvelopeStatus.COMPLETED ? { completedAt: now } : {}),
      ...(nextStatus === EnvelopeStatus.VOIDED ? { voidedAt: now } : {}),
    },
  });

  if (nextStatus !== EnvelopeStatus.COMPLETED) {
    return;
  }

  const isTender = envelope.docType === EnvelopeDocType.TENDER;
  const parent = isTender ? envelope.tender : envelope.contract;
  if (!parent) {
    return;
  }

  // Archive the executed PDF; a download failure must not block the status
  // advance (DocuSign retains the document and this can be re-fetched).
  if (envelope.docusignId) {
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
  const offer = await prisma.offer.findUnique({
    where: { id: parent.offerId },
    select: { id: true, offerStatus: true },
  });
  if (offer && offer.offerStatus !== signedStatus) {
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
  }
}
