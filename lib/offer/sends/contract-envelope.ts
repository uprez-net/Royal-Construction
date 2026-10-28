import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { EnvelopeDocType, OfferStatus } from "@prisma/client";
// import { generatePDF } from "@/lib/pdf/generate-pdf";
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
  contractParticularsToLockedTabs,
  parseContractParticulars,
} from "@/lib/offer/contract-particulars";
import { userPrincipal } from "@/lib/domain/principal";

import { formatContractMoney } from "@/lib/offer/project-handoff-commercials";
import {
  contractTermsInput,
  resolveContractTerms,
} from "@/lib/offer/contract-terms";
import { cancelRacedSend } from "@/lib/docusign/cancel-raced-send";
import {
  beginEnvelopeSendAttempt,
  claimEnvelopeSend,
  persistSentEnvelope,
  readContractOfferForSend,
  readContractParticularsForSend,
  recordEnvelopeSendEvent,
  releaseEnvelopeSendClaim,
  resolveEnvelopeSendAttempt,
  writeContractEnvelopeDocument,
} from "@/lib/domain/offers/envelope-send";
import type { EnvelopeSendPort } from "@/lib/domain/ports/envelope-send";
import type { User } from "@prisma/client";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import type { OfferSendEffects } from "@/lib/offer/sends/effects";

// Moved out of lib/data/offer-contract-sign.ts so the app and Eve run one send.
// The caller authorizes the user against the offer first; effects carry
// the post-write work only a caller can do (cache expiry, the lead-stage
// sync).

export type ContractSendResult =
  | { ok: true; reference: string; envelopeId: string }
  | { ok: false; error: string; status?: "CONTRACT_SENT" };

const contractEnvelopePort: EnvelopeSendPort<
  Parameters<typeof createContractEnvelope>[0],
  Awaited<ReturnType<typeof createContractEnvelope>>
> = { send: createContractEnvelope };

// Send the MBA BC4 building Contract for signature from the DocuSign template
// (DOCUSIGN_CONTRACT_TEMPLATE_ID; roles + tab labels in
// lib/docusign/contract-template-spec.md). Values derived from the signed
// Tender's frozen snapshot are locked, as are the estimator's BC4 particulars
// captured during CONTRACT_DRAFT (issue #98). The contract routes to the
// customer first (Owner routingOrder 1, Builder counter-signs at 2). Advances
// the offer to CONTRACT_SENT.
export async function sendContractEnvelope(
  user: User,
  input: {
    offerId: string;
    customerEmail?: string;
  },
  db: TransactionalDomainDb,
  effects: OfferSendEffects,
): Promise<ContractSendResult> {
  const offer = await readContractOfferForSend(db, input.offerId);
  if (
    offer.offerStatus !== OfferStatus.TENDER_SIGNED
    && offer.offerStatus !== OfferStatus.CONTRACT_DRAFT
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
    !config.contractTemplateId
    || !config.contractDefaultTemplateId
    || !config.contractMultipleOwnersTemplateId
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

  const claim = await claimEnvelopeSend(db, {
    fromStatuses: [OfferStatus.TENDER_SIGNED, OfferStatus.CONTRACT_DRAFT],
    offerId: offer.id,
    previousStatus: offer.offerStatus,
    toStatus: OfferStatus.CONTRACT_SENT,
  });
  if (claim.kind === "refused") {
    return {
      ok: false,
      error:
        claim.currentStatus === null
          ? "This offer no longer exists."
          : `The Contract cannot be sent from ${claim.currentStatus}; reload the live offer revision.`,
    };
  }

  // The claim has moved the offer out of CONTRACT_DRAFT, so the shared
  // particulars command can no longer change this row while the envelope is
  // assembled. Reading it after the atomic claim is therefore a frozen read.
  const contract = await readContractParticularsForSend(db, offer.id);

  const parsedParticulars = parseContractParticulars(
    contract?.particulars ?? null,
  );
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

  // Chosen once: the envelope is sent on it and the Contract row records it, so
  // a dispute reads the template the customer actually signed.
  const templateId =
    ownerSigners.length === 1
      ? config.contractTemplateId
      : ownerSigners.length === 2
        ? config.contractDefaultTemplateId
        : config.contractMultipleOwnersTemplateId;

  const sendAttemptId = `${offer.id}.${randomUUID()}`;
  const attemptStarted = new Date();
  // Before the send, not after it goes wrong (issue #321). Written in the
  // catch instead, a failed write left nothing blocking a recall, so a resend
  // could put a second live document in front of the customer — the exact
  // thing this record exists to prevent. Writing it first also covers the case
  // no catch can reach: the process dying mid-send.
  const sendAttemptRecordId = await beginEnvelopeSendAttempt(db, {
    attemptStarted,
    docType: EnvelopeDocType.CONTRACT,
    offerId: offer.id,
    sendAttemptId,
  });
  if (sendAttemptRecordId === null) {
    // Give the claim back, exactly as the rejection path does — nothing was
    // sent, so the offer must not sit at *_SENT. Refusing a send is
    // recoverable; sending with nothing to block a later recall is not.
    await releaseEnvelopeSendClaim(db, {
      claimedStatus: OfferStatus.CONTRACT_SENT,
      offerId: offer.id,
      previousStatus: offer.offerStatus,
    });
    return {
      ok: false,
      error:
        "Could not record the send attempt, so the Contract was not sent. Try again.",
    };
  }
  let envelope;
  let docusignContext: Awaited<
    ReturnType<typeof createDocusignContext>
  > | null = null;
  try {
    docusignContext = await createDocusignContext(config);
    envelope = await contractEnvelopePort.send({
      context: docusignContext,
      config,
      templateId,
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
      // Deliberately NOT settled here. The envelope exists, but nothing yet
      // records it — the success transaction below writes the Envelope row
      // AND settles this attempt together. Settling now would leave a real,
      // live envelope with nothing blocking a recall if that transaction then
      // failed, which is the same fail-open this record exists to close.
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
      await recordEnvelopeSendEvent(userPrincipal(user), db, {
        fromStatus: offer.offerStatus,
        note: `DocuSign did not respond in time — checking whether the Contract envelope was sent (${recovery.reason}). Do not resend until this is reconciled.`,
        offerId: offer.id,
        toStatus: OfferStatus.CONTRACT_SENT,
      });
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
      await recordEnvelopeSendEvent(userPrincipal(user), db, {
        fromStatus: offer.offerStatus,
        note: `DocuSign rejected the Contract envelope: ${reason}`,
        offerId: offer.id,
        toStatus: offer.offerStatus,
      });
      // Definitively refused, so nothing is out for signature and the attempt
      // must stop blocking a recall.
      await resolveEnvelopeSendAttempt(db, sendAttemptRecordId);
      await releaseEnvelopeSendClaim(db, {
        claimedStatus: OfferStatus.CONTRACT_SENT,
        offerId: offer.id,
        previousStatus: offer.offerStatus,
      });
      return {
        ok: false,
        error: `DocuSign envelope failed: ${reason}`,
      };
    }
  }

  const documentData = {
    templateId,
    tabs: Object.fromEntries(ownerTextTabs.map((t) => [t.tabLabel, t.value])),
    // Which copy of the schedule the contract went out on, for a dispute.
    paymentScheduleSource: payment.source,
  };

  const persisted = await persistSentEnvelope(userPrincipal(user), db, {
    claimedStatus: OfferStatus.CONTRACT_SENT,
    sendAttemptRecordId,
    docType: EnvelopeDocType.CONTRACT,
    documentVersion: offer.revisionNumber,
    envelopeId: envelope.envelopeId,
    note: `DocuSign contract envelope ${envelope.envelopeId} sent to ${ownerSigners
      .map((signer) => signer.email)
      .join(", ")}`,
    offerId: offer.id,
    previousStatus: offer.offerStatus,
    recipients: envelope.recipients,
    writeDocument: (tx, { claimed }) =>
      writeContractEnvelopeDocument(tx, {
        claimed,
        documentData,
        offerId: offer.id,
        version: offer.revisionNumber,
      }),
  });

  // Returned rather than raised: Next replaces a Server Action's thrown
  // message with a generic one in production, and the estimator needs the
  // envelope id and the instruction not to resend.
  if (persisted.kind === "unrecorded") {
    // The claim moved the offer to CONTRACT_SENT in its own transaction
    // before DocuSign was called, and only the envelope transaction rolled
    // back. So the stored status did change: revalidate and bring the lead
    // with it, or the screen shows a stale status and the lead sits a stage
    // behind while the client already has the document.
    effects.offerChanged(offer.id);
    await effects.statusChanged(offer.id);
    return {
      ok: false,
      status: OfferStatus.CONTRACT_SENT,
      error: `The Contract was sent (DocuSign envelope ${envelope.envelopeId}) but recording it failed. Do not resend — reconcile this envelope before continuing.`,
    };
  }

  // No *_SENT event and no lead sync: the offer is wherever the recall or
  // revision left it.
  if (persisted.kind === "raced") {
    effects.offerChanged(offer.id);
    return cancelRacedSend(envelope.envelopeId);
  }

  effects.offerChanged(offer.id);
  // The status moved to *_SENT above; bring the lead with it. Best effort
  // and outside any transaction — see syncLeadStageForOffer.
  await effects.statusChanged(offer.id);
  return { ok: true, reference, envelopeId: envelope.envelopeId };
}
