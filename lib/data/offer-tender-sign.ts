"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
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
import { buildTenderHtml, splitOwners } from "@/lib/offer/offer-tender-html";
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
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return { ok: false, error: "Unauthorized" };
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
  const owners = splitOwners(snapshot.job.clientNames).map((name) => ({
    name,
    email: customerEmail,
  }));

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
