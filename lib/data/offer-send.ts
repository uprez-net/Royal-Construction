"use server";

import { revalidateTag } from "next/cache";
import { randomBytes } from "node:crypto";
import { OfferStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { generatePDF } from "@/lib/utils/generatePDF";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildProposalHtml } from "@/lib/offer/offer-proposal-html";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { getGraphConfig } from "@/lib/graph/config";
import { createGraphContext } from "@/lib/graph/client";
import { authorizeOfferAccess } from "@/lib/data/offer-access";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type SendResult =
  | { ok: true; reference: string; token: string }
  | { ok: false; error: string };

// Email the offer PDF to the client with a reference token embedded in the
// subject (kept on replies as "Re: … [RCOFR-…]") so the inbound Graph webhook
// can correlate the reply back to this OfferDocumentSend record.
export async function sendOfferDocument(input: {
  offerId: string;
  recipientEmail: string;
}): Promise<SendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  const email = input.recipientEmail.trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid recipient email address." };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: {
      id: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      workspaceState: true,
    },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  if (!offer.workspaceState) {
    return { ok: false, error: "Add and save offer content before sending." };
  }

  let pdfBase64: string;
  try {
    const snapshot = deserializeWorkspace(
      parseWorkspaceState(offer.workspaceState),
    );
    const html = buildProposalHtml(buildProposalInput(snapshot), snapshot.images);
    pdfBase64 = await generatePDF({ html });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to generate the proposal PDF: ${(error as Error).message}`,
    };
  }

  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  const token = `RCOFR-${randomBytes(6).toString("hex").toUpperCase()}`;

  try {
    const client = await createGraphContext(getGraphConfig());
    await client.sendMail({
      to: email,
      subject: `Your Building Proposal — ${reference} [${token}]`,
      body: buildEmailBody(reference, token),
      attachments: [
        {
          name: `Building-Proposal-${reference}.pdf`,
          contentType: "application/pdf",
          contentBytes: pdfBase64,
        },
      ],
    });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to send the email: ${(error as Error).message}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.offerDocumentSend.create({
      data: {
        offerId: offer.id,
        offerFileVersion: offer.revisionNumber,
        recipientEmail: email,
        trackedLinkToken: token,
      },
    });
    if (offer.offerStatus === OfferStatus.PENDING) {
      await tx.offer.update({
        where: { id: offer.id },
        data: { offerStatus: OfferStatus.SENT, sentAt: new Date() },
      });
      await tx.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: OfferStatus.SENT,
          note: `Emailed to ${email}`,
        },
      });
    }
  });

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  return { ok: true, reference, token };
}

function buildEmailBody(reference: string, token: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.55;">
    <p>Hi,</p>
    <p>Please find attached your Building Proposal (<strong>${reference}</strong>) from Royal Constructions Pty Ltd.</p>
    <p>Everything is fixed into the price shown in the proposal. If you have any questions or changes, simply <strong>reply to this email</strong> and we'll take care of the rest.</p>
    <p>Kind regards,<br/>Royal Constructions Pty Ltd<br/>Lic. 383992C | MBA Accredited</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;" />
    <p style="font-size:11px;color:#999;">Proposal reference: ${token}. Please keep this reference in the subject line when replying so we can track your response.</p>
  </div>`;
}
