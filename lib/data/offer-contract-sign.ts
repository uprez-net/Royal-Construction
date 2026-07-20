"use server";

import { revalidateTag } from "next/cache";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  SignerRole,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
import { splitOwners } from "@/lib/offer/offer-tender-html";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { resolveOfferCustomerEmail } from "@/lib/offer/offer-customer-email";
import {
  createContractEnvelope,
  type ContractTabValue,
} from "@/lib/docusign/contract-envelope";

type ContractSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

function moneyWithCents(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(value);
}

// Send the MBA BC4 building Contract for signature from the DocuSign template
// (DOCUSIGN_CONTRACT_TEMPLATE_ID; roles + tab labels in
// lib/docusign/contract-template-spec.md). Values derived from the signed
// Tender's frozen snapshot are locked; the rest stay editable for the Builder,
// who signs first. Advances the offer to CONTRACT_SENT.
export async function sendContractForSignature(input: {
  offerId: string;
  customerEmail?: string;
}): Promise<ContractSendResult> {
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
      agreedSnapshot: true,
      lead: { select: { email: true } },
    },
  });
  if (!offer) {
    return { ok: false, error: "Offer not found." };
  }
  if (
    offer.offerStatus !== OfferStatus.TENDER_SIGNED &&
    offer.offerStatus !== OfferStatus.CONTRACT_DRAFT
  ) {
    return {
      ok: false,
      error: `The Contract can only be sent once the Tender is signed (current status: ${offer.offerStatus}).`,
    };
  }
  const state = offer.agreedSnapshot ?? offer.workspaceState;
  if (!state) {
    return { ok: false, error: "No agreed offer snapshot found." };
  }

  let config;
  try {
    config = getDocusignConfig();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!config.contractTemplateId) {
    return {
      ok: false,
      error:
        "DOCUSIGN_CONTRACT_TEMPLATE_ID is not configured — create the BC4 template first (see lib/docusign/contract-template-spec.md).",
    };
  }

  const snapshot = deserializeWorkspace(parseWorkspaceState(state));
  const job = snapshot.job;
  const customerEmail = resolveOfferCustomerEmail({
    overrideEmail: input.customerEmail,
    jobEmail: job.clientEmail,
    leadEmail: offer.lead?.email,
  });
  if (!customerEmail) {
    return {
      ok: false,
      error:
        "No valid client email found on the offer or lead — set the client email in Job setup before sending the Contract.",
    };
  }
  // The BC4 contract template exposes a single Customer signer role; the
  // primary owner is the named signer. ownerNames (rendered on the cover) is
  // populated with both clients when a secondary is present.
  const secondary = job.secondaryCustomerName?.trim() ?? "";

  // Resolve the price through the same path the Tender used — a blank override
  // round-trips to "0", so Number(...) would lock a $0.00 contract (the signed
  // Tender showed the computed value). buildProposalInput runs
  // resolveOptionalPriceInput + the computed-value fallback.
  const contractValue =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  const owners = splitOwners(job.clientNames);
  const primaryOwner = owners[0];
  // The BC4 contract template's ownerNames tab renders the named owners on the
  // cover. When a secondary client is present, name both so the printed
  // contract lists every co-owner (the template renders a single ownerNames
  // string; it does not split into separate signer roles here).
  const ownerNames = secondary
    ? `${job.clientNames} and ${secondary}`
    : job.clientNames;

  // ── Tab values (labels defined by scripts/docusign/create-bc4-template.ts;
  // unlocked particulars live in the template and are completed by the
  // builder while signing) ──
  const locked = (tabLabel: string, value: string): ContractTabValue => ({ tabLabel, value, locked: true });

  const priceLabel = moneyWithCents(contractValue);
  // The BC4 template exposes exactly 7 payment-stage slots. Refuse rather than
  // silently drop validated stages past the 7th, which would send a contract
  // whose payment schedule doesn't sum to the contract value.
  if (snapshot.paymentSchedule.length > 7) {
    return {
      ok: false,
      error: `The contract template supports up to 7 payment stages, but this schedule has ${snapshot.paymentSchedule.length}. Consolidate the payment schedule before sending the Contract.`,
    };
  }
  const stageRows = snapshot.paymentSchedule.slice(0, 7);
  const paymentScheduleLine = stageRows
    .map((row, index) => {
      const pct = (row.percentOfContract * 100).toFixed(0);
      return `(${index + 1}) ${row.stageName} ${pct}% ${moneyWithCents(contractValue * row.percentOfContract)}`;
    })
    .join("  |  ");
  const depositRow =
    stageRows.find((r) => r.stageName.toLowerCase().includes("deposit")) ?? stageRows[0];
  const exclusions = snapshot.draft.exclusionBullets;

  const builderTextTabs: ContractTabValue[] = [
    locked("contractPrice", priceLabel),
    locked("contractPriceTotal", priceLabel),
    locked("ownerNames", ownerNames),
    locked("ownerEmail", customerEmail),
    locked("siteAddress", job.siteAddress),
    locked("variationPercent", "10%"),
    locked("paymentSchedule", paymentScheduleLine),
    locked(
      "depositAmount",
      depositRow ? moneyWithCents(contractValue * depositRow.percentOfContract) : "",
    ),
    locked("excludedDays", "Saturdays, Sundays and NSW Public Holidays"),
    locked("defectsLiabilityWeeks", "12 Weeks"),
    locked("workDescription", [job.buildType, ...job.buildScope].filter(Boolean).join(". ")),
    locked("exclusionsList", exclusions.join("\n")),
  ];
  const ownerTextTabs: ContractTabValue[] = [locked("ownerPrintName", primaryOwner)];

  // Atomically claim the send so two concurrent calls can't both create a
  // DocuSign envelope (double-send); the claim is released on envelope failure.
  const claim = await prisma.offer.updateMany({
    where: {
      id: offer.id,
      offerStatus: {
        in: [OfferStatus.TENDER_SIGNED, OfferStatus.CONTRACT_DRAFT],
      },
    },
    data: { offerStatus: OfferStatus.CONTRACT_SENT },
  });
  if (claim.count === 0) {
    return {
      ok: false,
      error: "The Contract is already being sent or has been sent.",
    };
  }

  let envelope;
  try {
    const context = await createDocusignContext(config);
    envelope = await createContractEnvelope({
      context,
      config,
      templateId: config.contractTemplateId,
      emailSubject: `Residential Building Contract (BC4) — ${reference}`,
      builder: { name: config.builderSignerName, email: config.builderSignerEmail },
      owner: { name: primaryOwner, email: customerEmail },
      builderTextTabs,
      builderCheckboxTabs: [
        { tabLabel: "gstInclusive", selected: true },
        { tabLabel: "hbcfIncluded", selected: true },
        { tabLabel: "exclusionsYes", selected: exclusions.length > 0 },
      ],
      ownerTextTabs,
    });
  } catch (error) {
    // Release the claim so the builder can retry.
    await prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.CONTRACT_SENT },
      data: { offerStatus: offer.offerStatus },
    });
    return { ok: false, error: `DocuSign envelope failed: ${describeDocusignError(error)}` };
  }

  const documentData = {
    templateId: config.contractTemplateId,
    tabs: Object.fromEntries(
      [...builderTextTabs, ...ownerTextTabs].map((t) => [t.tabLabel, t.value]),
    ),
  };

  await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.upsert({
      where: { offerId: offer.id },
      update: { version: offer.revisionNumber, documentData },
      create: { offerId: offer.id, version: offer.revisionNumber, documentData },
    });
    await tx.envelope.create({
      data: {
        docType: EnvelopeDocType.CONTRACT,
        contractId: contract.id,
        docusignId: envelope.envelopeId,
        status: EnvelopeStatus.SENT,
        documentVersion: offer.revisionNumber,
        sentAt: new Date(),
        signatures: {
          create: envelope.recipients.map((recipient) => ({
            recipientRole:
              recipient.role === "BUILDER" ? SignerRole.BUILDER : SignerRole.CUSTOMER,
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
      data: { offerStatus: OfferStatus.CONTRACT_SENT },
    });
    await tx.offerStatusEvent.create({
      data: {
        offerId: offer.id,
        fromStatus: offer.offerStatus,
        toStatus: OfferStatus.CONTRACT_SENT,
        note: `DocuSign contract envelope ${envelope.envelopeId} sent to ${customerEmail}`,
      },
    });
  });

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}

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
