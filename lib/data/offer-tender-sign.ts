"use server";

import { revalidateTag } from "next/cache";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  SignerRole,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { generatePDF } from "@/lib/utils/generatePDF";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { buildTenderHtml, getTenderOwners } from "@/lib/offer/offer-tender-html";
import { getPaymentScheduleTotalPct } from "@/lib/offer/workspace-payment-schedule";
import { resolveOfferCustomerEmail } from "@/lib/offer/offer-customer-email";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { createTenderEnvelope } from "@/lib/docusign/tender-envelope";

type TenderSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

// Generate the Tender PDF from the frozen workspace snapshot and send it as a
// runtime DocuSign envelope (no template): signature tabs AutoPlace onto the
// anchor strings baked into the document. Builder signs first, then the
// owner(s). Persists Tender + Envelope + EnvelopeSignature for the legal
// audit trail and moves the offer to TENDER_SENT.
export async function sendTenderForSignature(input: {
  offerId: string;
}): Promise<TenderSendResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: {
      id: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      workspaceState: true,
      lead: true,
    },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  if (!offer.workspaceState) {
    return { ok: false, error: "Save the offer before sending the Tender." };
  }
  if (
    offer.offerStatus !== OfferStatus.TENDER_DRAFT &&
    offer.offerStatus !== OfferStatus.AGREED
  ) {
    return {
      ok: false,
      error: `Tender can only be sent from an agreed offer (current status: ${offer.offerStatus}).`,
    };
  }

  const snapshot = deserializeWorkspace(parseWorkspaceState(offer.workspaceState));

  // A Tender is a fixed-price contract: its progress-payment schedule must sum
  // to exactly the contract value (100%), or the customer is asked to sign a
  // schedule that over- or under-claims. Block sending an unbalanced schedule.
  const scheduleTotalPct = getPaymentScheduleTotalPct(snapshot.paymentSchedule);
  if (scheduleTotalPct !== 1) {
    return {
      ok: false,
      error: `The Tender payment schedule must total 100% before sending (currently ${Math.round(
        scheduleTotalPct * 100,
      )}%).`,
    };
  }

  const customerEmail = resolveOfferCustomerEmail({
    jobEmail: snapshot.job.clientEmail,
    leadEmail: offer.lead?.email,
  });
  if (!customerEmail) {
    return {
      ok: false,
      error:
        "No valid client email found on the offer or lead — set the client email in Job setup before sending the Tender.",
    };
  }
  // Secondary client receives their own copy of the envelope when they have a
  // distinct, sendable email. Falls back to the primary client's email (the
  // pre-secondary-client behaviour) when the secondary client has no email of
  // their own — every named owner still receives a signature tab.
  const secondaryRawEmail = (
    snapshot.job.secondaryCustomerEmail ?? ""
  ).trim();
  const secondaryOwnerName = (snapshot.job.secondaryCustomerName ?? "").trim();
  const hasSecondary = secondaryOwnerName.length > 0;
  const secondaryEmail =
    hasSecondary &&
    secondaryRawEmail.length > 0 &&
    secondaryRawEmail !== customerEmail &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(secondaryRawEmail)
      ? secondaryRawEmail
      : null;

  let config;
  try {
    config = getDocusignConfig();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const proposalInput = buildProposalInput(snapshot);
  let pdfBase64: string;
  try {
    pdfBase64 = await generatePDF({ html: buildTenderHtml(proposalInput) });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to generate the Tender PDF: ${(error as Error).message}`,
    };
  }

  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  // Build the DocuSign recipient list so each owner receives an envelope at
  // their own email when one is available. The secondary owner gets the
  // secondary email when present; otherwise both get the primary email (the
  // pre-secondary-client behaviour — every named owner still receives a
  // signature tab, just via the shared address).
  const owners = getTenderOwners(snapshot.job).map((name) => {
    const isSecondaryByName =
      hasSecondary &&
      name.trim().toLowerCase() === secondaryOwnerName.toLowerCase();
    return {
      name,
      email:
        isSecondaryByName && secondaryEmail ? secondaryEmail : customerEmail,
    };
  });

  // Atomically claim the send so two concurrent calls can't both create a
  // DocuSign envelope (double-send). Only the caller that flips the status off
  // TENDER_DRAFT/AGREED proceeds; the claim is released on envelope failure.
  const claim = await prisma.offer.updateMany({
    where: {
      id: offer.id,
      offerStatus: { in: [OfferStatus.TENDER_DRAFT, OfferStatus.AGREED] },
    },
    data: { offerStatus: OfferStatus.TENDER_SENT },
  });
  if (claim.count === 0) {
    return {
      ok: false,
      error: "The Tender is already being sent or has been sent.",
    };
  }

  let envelope;
  try {
    const context = await createDocusignContext(config);
    envelope = await createTenderEnvelope({
      context,
      config,
      pdfBase64,
      documentName: `Building-Tender-${reference}.pdf`,
      emailSubject: `Fixed Price Building Tender — ${reference}`,
      builder: {
        name: config.builderSignerName,
        email: config.builderSignerEmail,
      },
      owners,
    });
  } catch (error) {
    // Release the claim so the builder can retry.
    await prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.TENDER_SENT },
      data: { offerStatus: offer.offerStatus },
    });
    return {
      ok: false,
      error: `DocuSign envelope failed: ${describeDocusignError(error)}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    const tender = await tx.tender.upsert({
      where: { offerId: offer.id },
      update: {
        version: offer.revisionNumber,
        documentData: JSON.parse(JSON.stringify(proposalInput)),
      },
      create: {
        offerId: offer.id,
        version: offer.revisionNumber,
        documentData: JSON.parse(JSON.stringify(proposalInput)),
      },
    });
    await tx.envelope.create({
      data: {
        docType: EnvelopeDocType.TENDER,
        tenderId: tender.id,
        docusignId: envelope.envelopeId,
        status: EnvelopeStatus.SENT,
        documentVersion: offer.revisionNumber,
        sentAt: new Date(),
        signatures: {
          create: envelope.recipients.map((recipient) => ({
            recipientRole:
              recipient.role === "BUILDER"
                ? SignerRole.BUILDER
                : SignerRole.CUSTOMER,
            name: recipient.name,
            email: recipient.email,
            routingOrder: recipient.routingOrder,
            docusignRecipientId: recipient.recipientId,
          })),
        },
      },
    });
    await tx.offer.update({
      where: { id: offer.id },
      data: { offerStatus: OfferStatus.TENDER_SENT },
    });
    await tx.offerStatusEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: offer.offerStatus,
        toStatus: OfferStatus.TENDER_SENT,
        note: `DocuSign envelope ${envelope.envelopeId} sent to ${customerEmail}`,
      },
    });
  });

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}

// DocuSign SDK errors bury the useful message in response.body.
function describeDocusignError(error: unknown): string {
  const response = (error as { response?: { body?: unknown } }).response;
  if (response?.body) {
    const body = response.body as { errorCode?: string; message?: string };
    if (body.message) {
      return body.errorCode ? `${body.errorCode}: ${body.message}` : body.message;
    }
  }
  return (error as Error).message ?? "Unknown error";
}
