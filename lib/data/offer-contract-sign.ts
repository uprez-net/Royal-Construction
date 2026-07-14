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
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "@/lib/offer/workspace-persistence";
import { splitOwners } from "@/lib/offer/offer-tender-html";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import {
  createContractEnvelope,
  type ContractTabValue,
} from "@/lib/docusign/contract-envelope";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
      agreedSnapshot: true,
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
  const customerEmail = (input.customerEmail ?? job.clientEmail).trim();
  if (!EMAIL_RE.test(customerEmail)) {
    return { ok: false, error: "Set a valid client email before sending the Contract." };
  }

  const contractValue = Number(snapshot.selectedPriceInput) || 0;
  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;
  const owners = splitOwners(job.clientNames);
  const primaryOwner = owners[0];

  // ── Tab values (labels defined in contract-template-spec.md) ──
  const locked = (tabLabel: string, value: string): ContractTabValue => ({ tabLabel, value, locked: true });
  const open = (tabLabel: string): ContractTabValue => ({ tabLabel, value: "", locked: false });

  const priceLabel = moneyWithCents(contractValue);
  const stageRows = snapshot.paymentSchedule.slice(0, 7);
  const stageTabs: ContractTabValue[] = [];
  for (let i = 0; i < 7; i += 1) {
    const row = stageRows[i];
    if (row) {
      const pct = (row.percentOfContract * 100).toFixed(0);
      stageTabs.push(
        locked(`paymentStage${i + 1}`, `(${i + 1}) ${row.stageName} ${pct}%`),
        locked(`paymentAmount${i + 1}`, moneyWithCents(contractValue * row.percentOfContract)),
      );
    } else {
      stageTabs.push(locked(`paymentStage${i + 1}`, ""), locked(`paymentAmount${i + 1}`, ""));
    }
  }
  const depositRow =
    stageRows.find((r) => r.stageName.toLowerCase().includes("deposit")) ?? stageRows[0];
  const exclusions = snapshot.draft.exclusionBullets;

  const builderTextTabs: ContractTabValue[] = [
    locked("contractPrice", priceLabel),
    locked("ownerNames", job.clientNames),
    open("ownerAddress"),
    open("ownerPhone"),
    open("ownerMobile"),
    locked("ownerEmail", customerEmail),
    locked("siteAddress", job.siteAddress),
    locked("contractPriceFinance", priceLabel),
    open("hbcfCost"),
    locked("variationPercent", "10%"),
    ...stageTabs,
    locked("contractPriceSchedule", priceLabel),
    locked(
      "depositAmount",
      depositRow ? moneyWithCents(contractValue * depositRow.percentOfContract) : "",
    ),
    open("paymentDays"),
    open("interestRate"),
    open("commencementDate"),
    open("constructionDays"),
    locked("excludedDays", "Saturdays, Sundays and NSW Public Holidays"),
    open("demolitionMaterials"),
    locked("defectsLiabilityWeeks", "12 Weeks"),
    open("preContractCosts"),
    locked("workDescription", [job.buildType, ...job.buildScope].filter(Boolean).join(". ")),
    locked("exclusionsList", exclusions.join("\n")),
    open("specialConditions"),
  ];
  const ownerTextTabs: ContractTabValue[] = [
    locked("ownerPrintName", primaryOwner),
    open("ownerCapacity"),
  ];

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
