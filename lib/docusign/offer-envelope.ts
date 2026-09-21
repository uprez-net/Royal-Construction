import docusign from "docusign-esign";
import type { DocusignConfig } from "./config";
import type { DocusignContext } from "./client";
import type {
  EnvelopeSignerInput,
  EnvelopeRecipientRecord,
  CreateEnvelopeResult,
} from "./tender-envelope";
import { attachSendAttemptCustomField } from "./envelope-send-attempt";

// Customer-only Offer-acceptance envelope (ADR 0004).
//
// Unlike the Tender/Contract, the offer acceptance has NO builder recipient — the
// customer signs to ACCEPT the offer, and the builder's binding signature stays
// on the legal Tender/Contract. The acceptance PDF is generated at runtime (no
// DocuSign template) with signature/date anchors (\sigOwner{k}\ / \dateOwner{k}\)
// that AutoPlace onto the customer acceptance blocks; see
// lib/offer/offer-proposal-html.ts (forSignature mode). Because it is a runtime
// document, DocuSign does not renumber recipients, so the recipientIds we assign
// here are authoritative — no read-back needed.

// Anchor tab: DocuSign drops a SignHere/DateSigned tab onto the literal anchor
// string wherever it occurs in the PDF. Identical to the Tender's anchorTab.
function anchorTab(tag: string): docusign.SignHere {
  return {
    anchorString: `\\${tag}\\`,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "0",
    anchorIgnoreIfNotPresent: "true",
  } as docusign.SignHere;
}

export function buildOfferAcceptanceRecipientRecords(
  owners: readonly EnvelopeSignerInput[],
): readonly EnvelopeRecipientRecord[] {
  return owners.map<EnvelopeRecipientRecord>((owner, index) => ({
    role: "CUSTOMER",
    name: owner.name,
    email: owner.email,
    routingOrder: 1,
    recipientId: String(index + 1),
    capacity: owner.capacity ?? null,
    entityName: owner.entityName ?? null,
    entityAbn: owner.entityAbn ?? null,
  }));
}

export async function createOfferAcceptanceEnvelope(args: {
  readonly context: DocusignContext;
  readonly config: DocusignConfig;
  readonly pdfBase64: string;
  readonly documentName: string;
  readonly emailSubject: string;
  readonly owners: readonly EnvelopeSignerInput[];
  readonly sendAttemptId?: string;
}): Promise<CreateEnvelopeResult> {
  const { context, config, pdfBase64, documentName, emailSubject } = args;

  const document: docusign.Document = {
    documentBase64: pdfBase64,
    name: documentName,
    fileExtension: "pdf",
    documentId: "1",
  };

  // Customer-only: every owner/director signs in parallel at routingOrder 1.
  // recipientId is 1-based so it matches the sigOwner{k} anchor (k = index + 1)
  // baked into the acceptance PDF. There is no builder recipient and therefore no
  // routingOrder-2 counter-signer.
  const ownerSigners: docusign.Signer[] = args.owners.map((owner, index) => ({
    name: owner.name,
    email: owner.email,
    recipientId: String(index + 1),
    routingOrder: "1",
    tabs: {
      signHereTabs: [anchorTab(`sigOwner${index + 1}`)],
      dateSignedTabs: [anchorTab(`dateOwner${index + 1}`)],
    },
  }));

  const envelopeDefinition: docusign.EnvelopeDefinition = {
    emailSubject: emailSubject.slice(0, 100),
    documents: [document],
    recipients: { signers: ownerSigners },
    status: "sent",
  };

  if (args.sendAttemptId) {
    attachSendAttemptCustomField(envelopeDefinition, args.sendAttemptId);
  }

  // Envelope-level Connect: status events reach our webhook without any
  // account-level Connect config. includeHMAC is what makes DocuSign sign the
  // delivery; without it the webhook rejects every callback once the HMAC key is
  // set. Identical to the Tender/Contract envelopes.
  if (config.connectWebhookUrl) {
    envelopeDefinition.eventNotification = {
      url: config.connectWebhookUrl,
      loggingEnabled: "true",
      requireAcknowledgment: "true",
      includeHMAC: "true",
      deliveryMode: "SIM",
      events: [
        "envelope-sent",
        "envelope-delivered",
        "envelope-completed",
        "envelope-declined",
        "envelope-voided",
        "recipient-completed",
        "recipient-declined",
      ],
      eventData: {
        version: "restv2.1",
        format: "json",
        includeData: ["recipients"],
      },
    } as docusign.EventNotification;
  }

  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  const result = await envelopesApi.createEnvelope(context.accountId, {
    envelopeDefinition,
  });
  if (!result.envelopeId) {
    throw new Error("DocuSign did not return an envelope id.");
  }

  return {
    envelopeId: result.envelopeId,
    recipients: buildOfferAcceptanceRecipientRecords(args.owners),
  };
}
