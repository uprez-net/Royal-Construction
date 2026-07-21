import docusign from "docusign-esign";
import type { DocusignConfig } from "./config";
import type { DocusignContext } from "./client";
import type { EnvelopeRecipientRecord } from "./tender-envelope";

// The Contract is the MBA BC4 licensed form, sent from a DocuSign template
// (created once in the DocuSign UI) rather than a runtime PDF — see
// contract-template-spec.md for the template's roles and tab labels. Values
// derived from the signed Tender arrive as locked text tabs. The estimator's
// BC4 particulars (issue #98) are also captured in-app and sent as locked tabs,
// so the customer (routingOrder 1) receives a complete contract and the builder
// (routingOrder 2) counter-signs — the same customer-first order as the tender.
// Any particular the estimator leaves blank is simply not sent, so it stays the
// template's own unlocked tab for the builder to complete at counter-sign.
export interface ContractTabValue {
  readonly tabLabel: string;
  readonly value: string;
  readonly locked: boolean;
}

export interface CreateContractEnvelopeArgs {
  readonly context: DocusignContext;
  readonly config: DocusignConfig;
  readonly templateId: string;
  readonly emailSubject: string;
  readonly builder: { readonly name: string; readonly email: string };
  readonly owner: { readonly name: string; readonly email: string };
  readonly builderTextTabs: readonly ContractTabValue[];
  readonly builderCheckboxTabs: readonly { readonly tabLabel: string; readonly selected: boolean }[];
  readonly ownerTextTabs: readonly ContractTabValue[];
}

export interface CreateContractEnvelopeResult {
  readonly envelopeId: string;
  readonly recipients: readonly EnvelopeRecipientRecord[];
}

export async function createContractEnvelope(
  args: CreateContractEnvelopeArgs,
): Promise<CreateContractEnvelopeResult> {
  const { context, config, templateId, emailSubject } = args;

  const textTab = (t: ContractTabValue) => ({
    tabLabel: t.tabLabel,
    value: t.value,
    locked: t.locked ? "true" : "false",
  });

  const envelopeDefinition: docusign.EnvelopeDefinition = {
    templateId,
    emailSubject: emailSubject.slice(0, 100),
    // Customer-first routing (issue #98). templateRole.routingOrder overrides
    // the routing baked into the BC4 template, so the Owner signs first
    // (routingOrder 1) and the Builder counter-signs (routingOrder 2). DocuSign
    // emails routingOrder 1 the moment the envelope is sent, so the customer
    // receives the contract immediately instead of waiting behind the builder.
    templateRoles: [
      {
        roleName: "Builder",
        name: args.builder.name,
        email: args.builder.email,
        routingOrder: "2",
        tabs: {
          textTabs: args.builderTextTabs.map(textTab),
          checkboxTabs: args.builderCheckboxTabs.map((c) => ({
            tabLabel: c.tabLabel,
            selected: c.selected ? "true" : "false",
          })),
        } as docusign.Tabs,
      },
      {
        roleName: "Owner",
        name: args.owner.name,
        email: args.owner.email,
        routingOrder: "1",
        tabs: { textTabs: args.ownerTextTabs.map(textTab) } as docusign.Tabs,
      },
    ],
    status: "sent",
  };

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
      eventData: { version: "restv2.1", format: "json", includeData: ["recipients"] },
    } as docusign.EventNotification;
  }

  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  const result = await envelopesApi.createEnvelope(context.accountId, {
    envelopeDefinition,
  });
  if (!result.envelopeId) {
    throw new Error("DocuSign did not return an envelope id.");
  }

  // Template roles get recipient ids assigned by DocuSign — fetch them so the
  // Connect webhook can match signers by id rather than falling back to email.
  const recipients: EnvelopeRecipientRecord[] = [];
  try {
    const list = await envelopesApi.listRecipients(
      context.accountId,
      result.envelopeId,
      {},
    );
    for (const signer of list.signers ?? []) {
      const isBuilder =
        (signer.email ?? "").toLowerCase() === args.builder.email.toLowerCase();
      recipients.push({
        role: isBuilder ? "BUILDER" : "CUSTOMER",
        name: signer.name ?? (isBuilder ? args.builder.name : args.owner.name),
        email: signer.email ?? (isBuilder ? args.builder.email : args.owner.email),
        // Customer-first: Owner routes at 1, Builder counter-signs at 2.
        routingOrder: Number(signer.routingOrder ?? (isBuilder ? 2 : 1)),
        recipientId: signer.recipientId ?? (isBuilder ? "1" : "2"),
      });
    }
  } catch {
    // Non-fatal: the webhook still matches recipients by email.
  }
  // A partial listRecipients result (e.g. only one signer resolved, or the
  // builder email didn't match) must still yield both roles, or the webhook has
  // no record to match one party against. Restore each missing role's default.
  if (!recipients.some((recipient) => recipient.role === "BUILDER")) {
    recipients.push({ role: "BUILDER", name: args.builder.name, email: args.builder.email, routingOrder: 2, recipientId: "1" });
  }
  if (!recipients.some((recipient) => recipient.role === "CUSTOMER")) {
    recipients.push({ role: "CUSTOMER", name: args.owner.name, email: args.owner.email, routingOrder: 1, recipientId: "2" });
  }

  return { envelopeId: result.envelopeId, recipients };
}
