"use server";

import { revalidateTag } from "next/cache";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Prisma,
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
import { generatePDF } from "@/lib/utils/generatePDF";
import { buildContractSignatureAnnexureHtml } from "@/lib/offer/contract-annexure-html";
import {
  collectOfferSigners,
  collectOwnerIssues,
  formatOwnerNamesLine,
  MAX_OWNER_SIGNERS,
} from "@/lib/offer/workspace-model";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";
import { resolveOfferCustomerEmail } from "@/lib/offer/offer-customer-email";
import {
  createContractEnvelope,
  type ContractTabValue,
} from "@/lib/docusign/contract-envelope";
import {
  contractParticularsToLockedTabs,
  normalizeContractParticulars,
  parseContractParticulars,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";

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
// Tender's frozen snapshot are locked, as are the estimator's BC4 particulars
// captured during CONTRACT_DRAFT (issue #98). The contract routes to the
// customer first (Owner routingOrder 1, Builder counter-signs at 2). Advances
// the offer to CONTRACT_SENT.
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
      contract: { select: { particulars: true } },
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
  // Server-side owner gate (PR #124): re-validate owner completeness, especially
  // UNIQUE signer emails — a shared address makes the Contract completion webhook
  // (which falls back to email matching) attribute both signatures to one row,
  // corrupting the per-signer audit. Guards existing/directly-invoked offers.
  const contractOwnerIssues = collectOwnerIssues(job.owners);
  if (contractOwnerIssues.length > 0) {
    return {
      ok: false,
      error: `Complete the owner details before sending the Contract: ${contractOwnerIssues.join(" ")}`,
    };
  }
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
  // Resolve the price through the same path the Tender used — a blank override
  // round-trips to "0", so Number(...) would lock a $0.00 contract (the signed
  // Tender showed the computed value). buildProposalInput runs
  // resolveOptionalPriceInput + the computed-value fallback.
  const contractValue =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;

  // Owner parties (ADR 0003). The BC4 form has a single OWNER(S) area, so every
  // owner is named on the ownerNames line (companies annotated with ABN/ACN),
  // and the primary owner's Current Location + contact fill the single owner
  // address/contact lines (see below). The primary SIGNER — the primary owner
  // if an individual, else its first director — is the DocuSign Owner recipient.
  // NOTE: true N stacked owner/director signers (send-to-all, #103/#120) require
  // the BC4 template rework (bounded-max roles + stacked owner-area tabs). Until
  // then the primary signer signs on the owners' behalf; every owner is still
  // named on the contract and recorded on the signature audit.
  const ownerParties = job.owners ?? [];
  const contractSigners = collectOfferSigners(ownerParties);
  const primarySigner = contractSigners[0]?.signatory;
  const primaryEntityName = contractSigners[0]?.entityName ?? null;
  const primaryOwner = primarySigner?.name || job.clientNames;
  const ownerNames = formatOwnerNamesLine(ownerParties) || job.clientNames;
  // The primary signer's capacity for the BC4 capacity line, e.g. "Owner" or
  // "Director of ABC Pty Ltd".
  const capacityLabel = primaryEntityName
    ? `${primarySigner?.capacity ?? "Director"} of ${primaryEntityName}`
    : primarySigner?.capacity ?? "Owner";

  // Ordered customer-side signers for the envelope — each individual owner + each
  // company director (collectOfferSigners order). The primary carries the data
  // tabs; the rest sign the appended schedule (ADR 0003).
  const isValidEmail = (value: string): boolean =>
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
  // Every co-owner / director MUST have their own valid email — a fallback to
  // the primary's inbox would route their signing link to the wrong party
  // (codex #2). Only the primary may use the resolved customer email. Runs
  // before the send is claimed, so a rejection needs no status rollback.
  const contractSignersMissingEmail = contractSigners
    .filter(
      (signer, index) =>
        index > 0 && !isValidEmail((signer.signatory.email ?? "").trim()),
    )
    .map((signer) => signer.signatory.name.trim() || "a co-owner/director");
  if (contractSignersMissingEmail.length > 0) {
    return {
      ok: false,
      error: `Add a valid email for every signatory before sending the Contract — missing for: ${contractSignersMissingEmail.join(", ")}.`,
    };
  }
  const ownerSigners = contractSigners.map((signer, index) => {
    const own = (signer.signatory.email ?? "").trim();
    return {
      name: signer.signatory.name,
      email: index === 0 ? (isValidEmail(own) ? own : customerEmail) : own,
      capacity: signer.signatory.capacity,
      entityName: signer.entityName,
      entityAbn: signer.entityAbn,
    };
  });
  if (ownerSigners.length === 0) {
    ownerSigners.push({
      name: primaryOwner,
      email: customerEmail,
      capacity: "Owner",
      entityName: null,
      entityAbn: null,
    });
  }
  // Cap total signatories: the primary signs the BC4 form; the rest sign the
  // generated Owner Signature Schedule (annexure), a single page of blocks.
  // Refuse rather than silently drop a signatory (ADR 0003). Runs before the send
  // is claimed, so no status rollback is needed.
  // Shared with the offer-send owner gate (collectOwnerIssues) so the offer can't
  // be sent with more signers than the contract can complete (PR #124 review).
  if (ownerSigners.length > MAX_OWNER_SIGNERS) {
    return {
      ok: false,
      error: `This contract has ${ownerSigners.length} signatories; up to ${MAX_OWNER_SIGNERS} are supported. Reduce the owner/director signatories or arrange a separate signing.`,
    };
  }

  // The primary owner signs the BC4 form's owner line; every additional owner /
  // director signs the appended Owner Signature Schedule (the single BC4 owner
  // area only fits ~2 signatures before the Builder block — ADR 0003). Generate
  // it before the send is claimed so a failure needs no status rollback.
  let annexurePdfBase64: string | null = null;
  if (ownerSigners.length > 1) {
    try {
      annexurePdfBase64 = await generatePDF({
        html: buildContractSignatureAnnexureHtml({
          reference,
          siteAddress: job.siteAddress,
          ownerNamesLine: ownerNames,
          signers: ownerSigners.slice(1).map((signer) => ({
            name: signer.name,
            capacity: signer.capacity,
            entityName: signer.entityName,
          })),
        }),
      });
    } catch (error) {
      return {
        ok: false,
        error: `Failed to generate the owner signature schedule: ${(error as Error).message}`,
      };
    }
  }

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

  // Owner address/contact for the single BC4 owner lines. Current Location (from
  // Job setup) supersedes the hand-typed owner-address particular as the source
  // for the "of …" line (ADR 0003); the particular remains a fallback for offers
  // created before Current Location existed. Owner phone comes from the primary
  // signer; the mobile line stays on the particular (the owner model has one
  // phone per signatory).
  const parsedParticulars = parseContractParticulars(
    offer.contract?.particulars ?? null,
  );
  const ownerAddressValue =
    job.currentLocation.trim() || parsedParticulars.ownerAddress.trim();
  const ownerPhoneValue =
    (primarySigner?.phone ?? "").trim() || parsedParticulars.ownerPhone.trim();
  const ownerMobileValue = parsedParticulars.ownerMobile.trim();
  const ownerContactTabs: ContractTabValue[] = [];
  if (ownerAddressValue) ownerContactTabs.push(locked("ownerAddress", ownerAddressValue));
  if (ownerPhoneValue) ownerContactTabs.push(locked("ownerPhone", ownerPhoneValue));
  if (ownerMobileValue) ownerContactTabs.push(locked("ownerMobile", ownerMobileValue));

  // The DocuSign OWNER recipient routes to ownerSigners[0].email (the primary
  // signer's own email if valid, else the resolved customer email). The printed
  // ownerEmail tab MUST show that same address — using customerEmail directly let
  // a direct caller's override diverge from where the envelope actually went, so
  // the contract could display one email while routing to another (PR #124).
  const primaryOwnerEmail = ownerSigners[0]?.email ?? customerEmail;

  // Every value is a tab on the OWNER role (the first signer, issue #98), so the
  // customer sees the complete contract on open — derived Tender values, the
  // estimator's BC4 particulars, and the owner's print name. The Builder role
  // (routingOrder 2) carries only its signature (defined in the template).
  const ownerTextTabs: ContractTabValue[] = [
    locked("contractPrice", priceLabel),
    locked("contractPriceTotal", priceLabel),
    locked("ownerNames", ownerNames),
    locked("ownerEmail", primaryOwnerEmail),
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
    // Owner address/contact — sourced from the primary owner's Current Location +
    // contact (ADR 0003).
    ...ownerContactTabs,
    // The primary signer's capacity ("Owner" / "Director of ABC Pty Ltd").
    locked("ownerCapacity", capacityLabel),
    // Estimator-entered BC4 particulars (issue #98). Only the FILLED ones are
    // sent; a blank one stays the template's locked-empty tab — read-only, so
    // the customer can't type into a builder particular the estimator left blank.
    // The owner address/phone/mobile are excluded here — sourced above from the
    // owner party — so we never send a duplicate tab label.
    ...contractParticularsToLockedTabs(parsedParticulars).filter(
      (tab) => !["ownerAddress", "ownerPhone", "ownerMobile"].includes(tab.tabLabel),
    ),
    locked("ownerPrintName", primaryOwner),
  ];

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
      owners: ownerSigners,
      annexurePdfBase64,
      ownerTextTabs,
      ownerCheckboxTabs: [
        { tabLabel: "gstInclusive", selected: true },
        { tabLabel: "hbcfIncluded", selected: true },
        { tabLabel: "exclusionsYes", selected: exclusions.length > 0 },
      ],
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
    tabs: Object.fromEntries(ownerTextTabs.map((t) => [t.tabLabel, t.value])),
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
            // Empty id means "unknown" (composite readback failure) — persist
            // null so the webhook matches by email, not a wrong id (codex #3).
            docusignRecipientId: recipient.recipientId || null,
            capacity: recipient.capacity ?? null,
            entityName: recipient.entityName ?? null,
            entityAbn: recipient.entityAbn ?? null,
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
        // Record EVERY customer recipient the envelope routed to, not just the
        // primary — the contract fans out to each owner/director exactly like the
        // Tender does, and a single-address note misrepresents the audit trail
        // (PR #124 sweep; the identical defect was fixed on the Tender note).
        note: `DocuSign contract envelope ${envelope.envelopeId} sent to ${ownerSigners.map((signer) => signer.email).join(", ")}`,
      },
    });
  })
    .catch((error) => {
      // Same invariant as the Tender: the executed contract envelope is already
      // with the customer and cannot be un-sent, so never release the claim — a
      // retry would double-send a BC4 contract. Surface the envelope id so the
      // send can be reconciled (PR #124 sweep; this write was unguarded).
      console.error(
        `[offer] contract envelope ${envelope.envelopeId} sent but persisting it failed:`,
        error,
      );
      throw new Error(
        `The Contract was sent (DocuSign envelope ${envelope.envelopeId}) but recording it failed: ${(error as Error).message}. Do not resend — reconcile this envelope before continuing.`,
      );
    });

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}

type SaveParticularsResult = { ok: true } | { ok: false; error: string };

// Persist the estimator's BC4 particulars while the contract is a draft (issue
// #98). Upserts the Contract row so the values survive to send time, where they
// go out as locked tabs. Only editable in CONTRACT_DRAFT — once the envelope is
// sent the particulars are frozen into it and can't be changed without a recall.
export async function saveContractParticulars(input: {
  offerId: string;
  particulars: ContractParticulars;
}): Promise<SaveParticularsResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  const particulars = normalizeContractParticulars(
    input.particulars,
  ) as unknown as Prisma.InputJsonValue;

  // Validate + persist atomically. A separate "is it a draft?" read followed by
  // an upsert would let a concurrent send (which flips the offer to
  // CONTRACT_SENT) or a revision fork (which deactivates this row) slip in
  // between — writing particulars after the envelope is sent, or onto
  // superseded history. Guard the write on the offer's live state so it can only
  // land while the offer is an ACTIVE CONTRACT_DRAFT.
  const result = await prisma.$transaction(async (tx) => {
    // Common case — the contract row already exists: a single conditional
    // update whose predicate the database evaluates atomically.
    const updated = await tx.contract.updateMany({
      where: {
        offerId: input.offerId,
        offer: { offerStatus: OfferStatus.CONTRACT_DRAFT, isActive: true },
      },
      data: { particulars },
    });
    if (updated.count > 0) {
      return { ok: true as const };
    }
    // Nothing updated: either the contract row doesn't exist yet (first save) or
    // the offer is no longer an active draft. Re-check inside the transaction and
    // create the row only when it is genuinely a draft with no contract yet.
    const current = await tx.offer.findUnique({
      where: { id: input.offerId },
      select: {
        offerStatus: true,
        isActive: true,
        revisionNumber: true,
        contract: { select: { id: true } },
      },
    });
    if (
      !current ||
      !current.isActive ||
      current.offerStatus !== OfferStatus.CONTRACT_DRAFT ||
      current.contract
    ) {
      return {
        ok: false as const,
        error:
          "Contract particulars can only be edited while the contract is a draft.",
      };
    }
    // documentData is required on the model; it is (re)built from the frozen
    // snapshot at send time, so seed an empty object until then.
    await tx.contract.create({
      data: {
        offerId: input.offerId,
        version: current.revisionNumber,
        documentData: {},
        particulars,
      },
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return result;
  }
  revalidateTag(`offer-${input.offerId}`, CACHE_PROFILES.SHORT);
  return { ok: true };
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
