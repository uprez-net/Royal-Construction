"use server";

import { revalidateTag } from "next/cache";
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import {
  EnvelopeDocType,
  EnvelopeStatus,
  OfferStatus,
  Prisma,
  SignerRole,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { authorizeOfferAccess } from "@/lib/data/offer-access";
// import { generatePDF } from "@/lib/utils/generatePDF";
// import { buildContractSignatureAnnexureHtml } from "@/lib/offer/contract-annexure-html";
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
import { resolveEnvelopeCreateError } from "@/lib/docusign/envelope-send-attempt";
import { randomUUID } from "node:crypto";
import {
  CONTRACT_PARTICULAR_FIELDS,
  CONTRACT_PARTICULAR_MAX_LENGTH,
  CONTRACT_PARTICULAR_TOTAL_MAX_LENGTH,
  contractParticularsToLockedTabs,
  normalizeContractParticulars,
  parseContractParticulars,
  serializeContractParticulars,
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";

import { formatContractMoney } from "@/lib/offer/project-handoff-commercials";
import {
  contractTermsInput,
  resolveContractTerms,
} from "@/lib/offer/contract-terms";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";

type ContractSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string };

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
      tender: { select: { documentData: true } },
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
  // Through the helper the Contract step's loader uses, so the preview and the
  // BC4 resolve from the same copy of the offer.
  const termsInput = contractTermsInput(offer);
  if (!termsInput) {
    return { ok: false, error: "No agreed offer snapshot found." };
  }

  let config;
  try {
    config = getDocusignConfig();
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (
    !config.contractTemplateId ||
    !config.contractDefaultTemplateId ||
    !config.contractMultipleOwnersTemplateId
  ) {
    return {
      ok: false,
      error:
        "One or more required DocuSign contract template IDs are not configured — create the BC4 templates first (see lib/docusign/contract-template-spec.md).",
    };
  }

  const snapshot = termsInput.agreedSnapshot;
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

  // Same gate as the proposal and the Tender. A document that tells the client
  // their home is 0 m2 must not reach them, and this is the last place that can
  // refuse before the envelope is created.
  const totalAreaSqm = getAreaBasisTotalSqm(offerAreaBasisFromJob(job));
  if (totalAreaSqm <= 0) {
    return {
      ok: false,
      error: "Enter floor areas in Job setup before sending the Contract.",
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
  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;

  // The payment schedule and deposit come from the Tender the customer signed;
  // the price stays the agreed snapshot's. Terms the BC4 cannot carry, a Tender
  // that printed another price or more stages than the template has, are
  // refused before the send is claimed. The Contract step previews the same
  // terms and the same refusal, so it shows what the BC4 carries.
  const { payment, terms: contractTerms } = resolveContractTerms(termsInput);
  const contractValue = contractTerms.contractValueIncGst;
  if (payment.source === "agreed-snapshot") {
    console.warn(
      `[offer] contract for offer ${offer.id}: no payment schedule on the Tender row, using the agreed snapshot's`,
    );
  } else {
    console.info(
      `[offer] contract for offer ${offer.id}: payment schedule from the signed Tender (${payment.source})`,
    );
  }
  if (contractTerms.refusal) {
    return { ok: false, error: contractTerms.refusal };
  }

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
    : (primarySigner?.capacity ?? "Owner");

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
  // const annexurePdfBase64: string | null = null;
  // if (ownerSigners.length > 1) {
  //   try {
  //     annexurePdfBase64 = await generatePDF({
  //       html: buildContractSignatureAnnexureHtml({
  //         reference,
  //         siteAddress: job.siteAddress,
  //         ownerNamesLine: ownerNames,
  //         signers: ownerSigners.slice(1).map((signer) => ({
  //           name: signer.name,
  //           capacity: signer.capacity,
  //           entityName: signer.entityName,
  //         })),
  //       }),
  //     });
  //   } catch (error) {
  //     return {
  //       ok: false,
  //       error: `Failed to generate the owner signature schedule: ${(error as Error).message}`,
  //     };
  //   }
  // }

  // ── Tab values (labels defined by scripts/docusign/create-bc4-template.ts;
  // unlocked particulars live in the template and are completed by the
  // builder while signing) ──
  const locked = (tabLabel: string, value: string): ContractTabValue => ({
    tabLabel,
    value,
    locked: true,
  });

  const priceLabel = formatContractMoney(contractValue);

  const claim = await prisma.$transaction(async (tx) => {
    const updated = await tx.offer.updateMany({
      where: {
        id: offer.id,
        offerStatus: {
          in: [OfferStatus.TENDER_SIGNED, OfferStatus.CONTRACT_DRAFT],
        },
      },
      data: { offerStatus: OfferStatus.CONTRACT_SENT },
    });
    if (updated.count === 0) {
      return { claimed: false as const, particulars: null };
    }
    const contract = await tx.contract.findUnique({
      where: { offerId: offer.id },
      select: { particulars: true },
    });
    return {
      claimed: true as const,
      particulars: contract?.particulars ?? null,
    };
  });
  if (!claim.claimed) {
    return {
      ok: false,
      error: "The Contract is already being sent or has been sent.",
    };
  }

  const parsedParticulars = parseContractParticulars(claim.particulars);
  // contractTerms carries everything the BC4 needs, exclusions included: the
  // shared resolver reads them from the signed Tender's stored document, so the
  // Contract step's preview and this send cannot show different lines.
  if (contractTerms.exclusionsSource === "agreed-snapshot") {
    console.warn(
      `[offer] contract for offer ${offer.id}: no readable exclusions on the Tender row, using the agreed snapshot's`,
    );
  }
  const exclusions = contractTerms.exclusions;

  // Owner address/contact for the single BC4 owner lines. Current Location (from
  // Job setup) supersedes the hand-typed owner-address particular as the source
  // for the "of …" line (ADR 0003); the particular remains a fallback for offers
  // created before Current Location existed. Owner phone comes from the primary
  // signer; the mobile line stays on the particular (the owner model has one
  // phone per signatory).
  const ownerAddressValue =
    job.currentLocation.trim() || parsedParticulars.ownerAddress.trim();
  const ownerPhoneValue =
    (primarySigner?.phone ?? "").trim() || parsedParticulars.ownerPhone.trim();
  const ownerMobileValue = parsedParticulars.ownerMobile.trim();
  const ownerContactTabs: ContractTabValue[] = [];
  if (ownerAddressValue)
    ownerContactTabs.push(locked("ownerAddress", ownerAddressValue));
  if (ownerPhoneValue)
    ownerContactTabs.push(locked("ownerPhone", ownerPhoneValue));
  if (ownerMobileValue)
    ownerContactTabs.push(locked("ownerMobile", ownerMobileValue));

  // Owners 2–4 (issue #142): page ii's "ADDITIONAL OWNERS" table carries one
  // row per extra owner with NAME / ADDRESS / TELEPHONE / MOBILE. Each value is
  // a locked tab on the Owner role (the primary signer), matching the Owner 1
  // pattern above. A blank field is left UNSET — the template's locked-empty
  // tab stays read-only without sending an empty string that would visually
  // clutter the table. Owners never exceed 4 in practice, so indexes 1–3 are
  // handled explicitly/safely rather than via generic N-owner scaffolding.
  const additionalOwnerTabs: ContractTabValue[] = [];
  const additionalOwnerIndexes = [1, 2, 3] as const;
  for (const i of additionalOwnerIndexes) {
    const owner = ownerParties[i];
    const ownerSignatory = contractSigners[i]?.signatory;
    if (!owner) break;
    const name = owner.displayName.trim();
    const address = owner.currentLocation.trim();
    const phone = (owner.signatories[0]?.phone ?? "").trim();
    const mobile = (owner.signatories[0]?.mobile ?? "").trim();
    const capacity = ownerSignatory?.capacity ?? null;
    const tabSuffix = i + 1; // owner2 / owner3 / owner4
    if (name) {
      additionalOwnerTabs.push(locked(`owner${tabSuffix}PrintName`, name));
      additionalOwnerTabs.push(locked(`owner${tabSuffix}Name`, name));
    }
    if (address)
      additionalOwnerTabs.push(locked(`owner${tabSuffix}Address`, address));
    if (phone)
      additionalOwnerTabs.push(locked(`owner${tabSuffix}Phone`, phone));
    if (mobile)
      additionalOwnerTabs.push(locked(`owner${tabSuffix}Mobile`, mobile));
    if (capacity)
      additionalOwnerTabs.push(locked(`owner${tabSuffix}Capacity`, capacity));
  }

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
    locked("paymentSchedule", contractTerms.paymentScheduleLine),
    locked("depositAmount", contractTerms.depositAmount),
    locked("excludedDays", "Saturdays, Sundays and NSW Public Holidays"),
    locked("defectsLiabilityWeeks", "12 Weeks"),
    locked(
      "workDescription",
      [job.buildType, ...job.buildScope].filter(Boolean).join(". "),
    ),
    locked("exclusionsList", exclusions.join("\n")),
    // Owner address/contact — sourced from the primary owner's Current Location +
    // contact (ADR 0003).
    ...ownerContactTabs,
    // Owners 2–4 contact rows (issue #142) — the "ADDITIONAL OWNERS" table on
    // page ii. Populated from each owner's Current Location + primary signatory's
    // phone/mobile; blank fields are omitted (locked-empty in the template).
    ...additionalOwnerTabs,
    // The primary signer's capacity ("Owner" / "Director of ABC Pty Ltd").
    locked("ownerCapacity", capacityLabel),
    // Estimator-entered BC4 particulars (issue #98). Only the FILLED ones are
    // sent; a blank one stays the template's locked-empty tab — read-only, so
    // the customer can't type into a builder particular the estimator left blank.
    // The owner address/phone/mobile are excluded here — sourced above from the
    // owner party — so we never send a duplicate tab label.
    ...contractParticularsToLockedTabs(parsedParticulars).filter(
      (tab) =>
        !["ownerAddress", "ownerPhone", "ownerMobile"].includes(tab.tabLabel),
    ),
    locked("ownerPrintName", primaryOwner),
  ];

  const sendAttemptId = `${offer.id}.${randomUUID()}`;
  const attemptStarted = new Date();
  let envelope;
  let docusignContext: Awaited<
    ReturnType<typeof createDocusignContext>
  > | null = null;
  try {
    docusignContext = await createDocusignContext(config);
    envelope = await createContractEnvelope({
      context: docusignContext,
      config,
      templateId:
        ownerSigners.length === 1
          ? config.contractTemplateId
          : ownerSigners.length === 2
            ? config.contractDefaultTemplateId
            : config.contractMultipleOwnersTemplateId,
      emailSubject: `Residential Building Contract (BC4) — ${reference}`,
      builder: {
        name: config.builderSignerName,
        email: config.builderSignerEmail,
      },
      owners: ownerSigners,
      // annexurePdfBase64,
      ownerTextTabs,
      ownerCheckboxTabs: [
        { tabLabel: "gstInclusive", selected: true },
        { tabLabel: "hbcfIncluded", selected: true },
        { tabLabel: "exclusionsYes", selected: exclusions.length > 0 },
      ],
      sendAttemptId,
    });
  } catch (error) {
    const recovery = await resolveEnvelopeCreateError({
      error,
      context: docusignContext,
      sendAttemptId,
      attemptStarted,
    });
    if (recovery.kind === "reconciled") {
      envelope = {
        envelopeId: recovery.envelopeId,
        recipients: [
          {
            role: "BUILDER",
            name: config.builderSignerName,
            email: config.builderSignerEmail,
            routingOrder: 2,
            recipientId: "",
            capacity: null,
            entityName: null,
            entityAbn: null,
          },
          ...ownerSigners.map((signer) => ({
            role: "CUSTOMER" as const,
            name: signer.name,
            email: signer.email,
            routingOrder: 1,
            recipientId: "",
            capacity: signer.capacity ?? null,
            entityName: signer.entityName ?? null,
            entityAbn: signer.entityAbn ?? null,
          })),
        ],
      };
    } else if (recovery.kind === "outcome-unknown") {
      await prisma.offerStatusEvent
        .create({
          data: {
            offerId: offer.id,
            fromStatus: offer.offerStatus,
            toStatus: OfferStatus.CONTRACT_SENT,
            note: `DocuSign did not respond in time — checking whether the Contract envelope was sent (${recovery.reason}). Do not resend until this is reconciled.`,
            actorId: access.user.id,
          },
        })
        .catch((eventError) =>
          console.error(
            "[offer] recording the unknown contract envelope outcome failed:",
            eventError,
          ),
        );
      // The durable half of the reconcile attempt — see UnconfirmedEnvelopeSend
      // and #321. `Contract` is only created on confirmed success, so there is
      // no row an Envelope could hang off yet.
      await prisma.unconfirmedEnvelopeSend
        .create({
          data: {
            offerId: offer.id,
            docType: EnvelopeDocType.CONTRACT,
            sendAttemptId,
            attemptStartedAt: attemptStarted,
          },
        })
        .catch((recordError) =>
          console.error(
            "[offer] recording the unconfirmed contract send failed — a recall will not see it:",
            recordError,
          ),
        );
      return {
        ok: false,
        error:
          "DocuSign did not confirm whether the Contract was sent. Do not resend — wait for reconciliation or check DocuSign before trying again.",
      };
    } else {
      const reason = recovery.reason;
      console.error(
        `[offer] contract envelope creation failed for offer ${offer.id}; claim released:`,
        reason,
        error,
      );
      await prisma.offerStatusEvent
        .create({
          data: {
            offerId: offer.id,
            fromStatus: offer.offerStatus,
            toStatus: offer.offerStatus,
            note: `DocuSign rejected the Contract envelope: ${reason}`,
            actorId: access.user.id,
          },
        })
        .catch((eventError) =>
          console.error(
            "[offer] recording the rejected contract envelope failed:",
            eventError,
          ),
        );
      await prisma.offer.updateMany({
        where: { id: offer.id, offerStatus: OfferStatus.CONTRACT_SENT },
        data: { offerStatus: offer.offerStatus },
      });
      return {
        ok: false,
        error: `DocuSign envelope failed: ${reason}`,
      };
    }
  }

  const documentData = {
    templateId: config.contractTemplateId,
    tabs: Object.fromEntries(ownerTextTabs.map((t) => [t.tabLabel, t.value])),
    // Which copy of the schedule the contract went out on, for a dispute.
    paymentScheduleSource: payment.source,
  };

  const stillClaimed = await prisma
    .$transaction(async (tx) => {
      // Claim first, then write. Returning from a transaction callback COMMITS
      // it (only a throw rolls back), so a recall or Create revision that ran
      // while DocuSign was creating the envelope used to have the writes below
      // land anyway: the stored document was replaced and executedPdfUrl cleared
      // on a document that may already be executed, even though the raced
      // envelope is voided straight after. The envelope row is still written, so
      // the raced envelope stays on the audit trail and can be cancelled.
      const stillSent = await tx.offer.updateMany({
        where: {
          id: offer.id,
          offerStatus: OfferStatus.CONTRACT_SENT,
          isActive: true,
        },
        data: { offerStatus: OfferStatus.CONTRACT_SENT },
      });
      const claimed = stillSent.count > 0;
      const contract = await tx.contract.upsert({
        where: { offerId: offer.id },
        // A new envelope replaces the document, so the last envelope's executed
        // PDF no longer describes it. The webhook files this one's on completion.
        // A raced send owns nothing, so it leaves the stored document alone.
        update: claimed
          ? {
              version: offer.revisionNumber,
              documentData,
              executedPdfUrl: null,
            }
          : {},
        create: {
          offerId: offer.id,
          version: offer.revisionNumber,
          documentData,
        },
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
                recipient.role === "BUILDER"
                  ? SignerRole.BUILDER
                  : SignerRole.CUSTOMER,
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
      if (!claimed) {
        return false;
      }
      await tx.offerStatusEvent.create({
        data: {
          offerId: offer.id,
          fromStatus: offer.offerStatus,
          toStatus: OfferStatus.CONTRACT_SENT,
          actorId: access.user.id,
          // Record EVERY customer recipient the envelope routed to, not just the
          // primary — the contract fans out to each owner/director exactly like the
          // Tender does, and a single-address note misrepresents the audit trail
          // (PR #124 sweep; the identical defect was fixed on the Tender note).
          note: `DocuSign contract envelope ${envelope.envelopeId} sent to ${ownerSigners.map((signer) => signer.email).join(", ")}`,
        },
      });
      return true;
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
      return { unrecorded: (error as Error).message } as const;
    });

  // Returned rather than raised: Next replaces a Server Action's thrown
  // message with a generic one in production, and the estimator needs the
  // envelope id and the instruction not to resend.
  if (typeof stillClaimed === "object") {
    return {
      ok: false,
      error: `The Contract was sent (DocuSign envelope ${envelope.envelopeId}) but recording it failed. Do not resend — reconcile this envelope before continuing.`,
    };
  }

  // No *_SENT event and no lead sync: the offer is wherever the recall or
  // revision left it.
  if (!stillClaimed) {
    revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
    return cancelRacedSend(envelope.envelopeId);
  }

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  // The status moved to *_SENT above; bring the lead with it. Best effort
  // and outside any transaction — see syncLeadStageForOffer.
  await syncLeadStageForOffer(offer.id);
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
  manualOverrides: readonly ContractParticularKey[];
}): Promise<SaveParticularsResult> {
  const access = await authorizeOfferAccess(input.offerId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }

  const normalizedParticulars = normalizeContractParticulars(input.particulars);
  const totalLength = CONTRACT_PARTICULAR_FIELDS.reduce(
    (total, field) => total + normalizedParticulars[field.key].length,
    0,
  );
  if (
    CONTRACT_PARTICULAR_FIELDS.some(
      (field) =>
        normalizedParticulars[field.key].length >
        CONTRACT_PARTICULAR_MAX_LENGTH,
    ) ||
    totalLength > CONTRACT_PARTICULAR_TOTAL_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: "Contract particulars exceed the permitted field or total length.",
    };
  }
  const particulars = serializeContractParticulars(
    normalizedParticulars,
    input.manualOverrides,
  ) as unknown as Prisma.InputJsonValue;

  // Validate + persist atomically. A separate "is it a draft?" read followed by
  // an upsert would let a concurrent send (which flips the offer to
  // CONTRACT_SENT) or a revision fork (which deactivates this row) slip in
  // between — writing particulars after the envelope is sent, or onto
  // superseded history. Guard the write on the offer's live state so it can only
  // land while the offer is an ACTIVE CONTRACT_DRAFT.
  const result = await prisma.$transaction(async (tx) => {
    const lockedOffer = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Offer" WHERE "id" = ${input.offerId} FOR UPDATE`,
    );
    if (lockedOffer.length === 0) {
      return {
        ok: false as const,
        error: "Offer not found.",
      };
    }
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
