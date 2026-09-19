import docusign from "docusign-esign";
import type { DocusignConfig } from "./config";
import type { DocusignContext } from "./client";
import { attachSendAttemptCustomField } from "./envelope-send-attempt";

// No DocuSign templates: the Tender PDF is generated at runtime and the
// signature tabs AutoPlace onto the anchor strings the HTML already embeds
// (\sigBuilder\, \dateBuilder\, \sigOwnerN\, \dateOwnerN\, \initOwnerN\ —
// see lib/offer/offer-tender-html.ts).
export interface EnvelopeSignerInput {
  readonly name: string;
  readonly email: string;
  // Descriptive audit metadata persisted on EnvelopeSignature (ADR 0003) — NOT
  // sent to DocuSign. capacity is "Owner" (individual) or "Director"; entity*
  // name the company a director signs for. Optional; the builder omits them.
  readonly capacity?: string | null;
  readonly entityName?: string | null;
  readonly entityAbn?: string | null;
}

export interface EnvelopeRecipientRecord {
  readonly role: "BUILDER" | "CUSTOMER";
  readonly name: string;
  readonly email: string;
  readonly routingOrder: number;
  readonly recipientId: string;
  readonly capacity?: string | null;
  readonly entityName?: string | null;
  readonly entityAbn?: string | null;
}

export interface CreateEnvelopeResult {
  readonly envelopeId: string;
  readonly recipients: readonly EnvelopeRecipientRecord[];
}

// Anchor tabs match the literal anchor text wherever it occurs in the PDF, so
// initials (rendered on the execution page note) land exactly where written.
function anchorTab(tag: string): docusign.SignHere {
  return {
    anchorString: `\\${tag}\\`,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "0",
    anchorIgnoreIfNotPresent: "true",
  } as docusign.SignHere;
}

export function buildTenderEnvelopeRecipientRecords(
  builder: EnvelopeSignerInput,
  owners: readonly EnvelopeSignerInput[],
): readonly EnvelopeRecipientRecord[] {
  return [
    {
      role: "BUILDER",
      name: builder.name,
      email: builder.email,
      routingOrder: 2,
      recipientId: "1",
    },
    ...owners.map<EnvelopeRecipientRecord>((owner, index) => ({
      role: "CUSTOMER",
      name: owner.name,
      email: owner.email,
      routingOrder: 1,
      recipientId: String(index + 2),
      capacity: owner.capacity ?? null,
      entityName: owner.entityName ?? null,
      entityAbn: owner.entityAbn ?? null,
    })),
  ];
}

export async function createTenderEnvelope(args: {
  readonly context: DocusignContext;
  readonly config: DocusignConfig;
  readonly pdfBase64: string;
  readonly documentName: string;
  readonly emailSubject: string;
  readonly builder: EnvelopeSignerInput;
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

  // Customer/owner(s) sign first (routing 1); Royal (the builder) counter-signs
  // to execute (routing 2). DocuSign emails routing-order 1 the moment the
  // envelope is sent, so the customer receives the Tender immediately instead of
  // waiting behind the builder's signature. If the customer declines, the
  // builder is never troubled for a signature on a superseded Tender.
  const builderSigner: docusign.Signer = {
    name: args.builder.name,
    email: args.builder.email,
    recipientId: "1",
    routingOrder: "2",
    tabs: {
      signHereTabs: [anchorTab("sigBuilder")],
      dateSignedTabs: [anchorTab("dateBuilder")],
    },
  };

  const ownerSigners: docusign.Signer[] = args.owners.map((owner, index) => ({
    name: owner.name,
    email: owner.email,
    recipientId: String(index + 2),
    routingOrder: "1",
    tabs: {
      signHereTabs: [anchorTab(`sigOwner${index + 1}`)],
      dateSignedTabs: [anchorTab(`dateOwner${index + 1}`)],
      initialHereTabs: [anchorTab(`initOwner${index + 1}`)],
    },
  }));

  const envelopeDefinition: docusign.EnvelopeDefinition = {
    emailSubject: emailSubject.slice(0, 100),
    documents: [document],
    recipients: { signers: [builderSigner, ...ownerSigners] },
    status: "sent",
  };

  if (args.sendAttemptId) {
    attachSendAttemptCustomField(envelopeDefinition, args.sendAttemptId);
  }

  // Envelope-level Connect: status events land on our webhook without any
  // account-level Connect configuration. includeHMAC is what makes DocuSign
  // send x-docusign-signature-1; without it the webhook route rejects every
  // delivery as unsigned once DOCUSIGN_CONNECT_HMAC_KEY is set.
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
    recipients: buildTenderEnvelopeRecipientRecords(args.builder, args.owners),
  };
}

// Download the fully executed (combined) PDF for archival once the envelope
// completes.
export async function downloadCombinedDocument(
  context: DocusignContext,
  envelopeId: string,
): Promise<Buffer> {
  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  const data = await envelopesApi.getDocument(
    context.accountId,
    envelopeId,
    "combined",
    {},
  );
  return Buffer.isBuffer(data) ? data : Buffer.from(data as string, "binary");
}
