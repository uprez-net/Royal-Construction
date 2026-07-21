import docusign from "docusign-esign";
import type { DocusignConfig } from "./config";
import type { DocusignContext } from "./client";
import type { EnvelopeRecipientRecord } from "./tender-envelope";

// The Contract is the MBA BC4 licensed form, sent from a DocuSign template
// (created once via scripts/docusign/create-bc4-template.ts) rather than a
// runtime PDF — see contract-template-spec.md for the roles and tab labels.
// Customer-first (issue #98): EVERY contract value is a tab on the OWNER role
// (routingOrder 1, signs first) — derived Tender values + the estimator's BC4
// particulars, all locked/read-only — so the customer sees the complete
// contract on open. The Builder (routingOrder 2) counter-signs. A particular
// the estimator leaves blank stays the template's locked-empty tab (read-only),
// so the customer can't type into a builder field.
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
  // All contract data goes on the OWNER role (the first signer, issue #98) so
  // the customer sees a complete contract on open. The Builder (routingOrder 2)
  // carries only its signature — no data tabs.
  readonly ownerTextTabs: readonly ContractTabValue[];
  readonly ownerCheckboxTabs: readonly { readonly tabLabel: string; readonly selected: boolean }[];
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
    // receives the contract immediately. All data tabs are on the Owner role so
    // the customer sees them (a recipient always sees its own locked tabs); the
    // Builder role carries only the counter-signature defined in the template.
    templateRoles: [
      {
        roleName: "Builder",
        name: args.builder.name,
        email: args.builder.email,
        routingOrder: "2",
      },
      {
        roleName: "Owner",
        name: args.owner.name,
        email: args.owner.email,
        routingOrder: "1",
        tabs: {
          textTabs: args.ownerTextTabs.map(textTab),
          checkboxTabs: args.ownerCheckboxTabs.map((c) => ({
            tabLabel: c.tabLabel,
            selected: c.selected ? "true" : "false",
          })),
        } as docusign.Tabs,
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
