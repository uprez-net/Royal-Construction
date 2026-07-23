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

export interface ContractOwnerSigner {
  readonly name: string;
  readonly email: string;
  // Audit metadata (ADR 0003) persisted on EnvelopeSignature — the signer's
  // capacity ("Owner"/"Director") and the company they sign for.
  readonly capacity?: string | null;
  readonly entityName?: string | null;
  readonly entityAbn?: string | null;
}

// Vertical spacing (pixels) between stacked owner signatures in the single
// OWNER(S) area (the BC4 form has no per-owner tokens — see
// contract-template-spec.md). NEEDS one-time visual calibration on a sandbox
// send, like the checkbox offsets in create-bc4-template.ts.
const OWNER_SIGNATURE_STACK_STEP_PX = 26;

export interface CreateContractEnvelopeArgs {
  readonly context: DocusignContext;
  readonly config: DocusignConfig;
  readonly templateId: string;
  readonly emailSubject: string;
  readonly builder: { readonly name: string; readonly email: string };
  // Ordered customer-side signers, primary first (collectOfferSigners order).
  // The PRIMARY carries all data tabs + the primary signature from the template;
  // signers 2..N are added as extra recipients whose signature stacks in the
  // single OWNER(S) area via a vertical anchor offset. N=1 uses the plain
  // templateRoles path (unchanged, known-good).
  readonly owners: readonly ContractOwnerSigner[];
  // All contract data goes on the primary OWNER (issue #98) so the customer sees
  // a complete contract on open. The Builder (routingOrder 2) carries only its
  // signature — no data tabs.
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
  const owners = args.owners;
  const primary = owners[0];
  if (!primary) {
    throw new Error("A contract envelope needs at least one owner signer.");
  }

  const textTab = (t: ContractTabValue) => ({
    tabLabel: t.tabLabel,
    value: t.value,
    locked: t.locked ? "true" : "false",
  });
  // Customer-first (issue #98): the primary Owner (routingOrder 1) carries ALL
  // data tabs so the customer opens a complete contract; the Builder counter-
  // signs (routingOrder 2). A recipient always sees its own locked tabs.
  const ownerTabs = {
    textTabs: args.ownerTextTabs.map(textTab),
    checkboxTabs: args.ownerCheckboxTabs.map((c) => ({
      tabLabel: c.tabLabel,
      selected: c.selected ? "true" : "false",
      // Derived contract terms — locked so the customer can't toggle them.
      locked: "true",
    })),
  } as docusign.Tabs;

  const builderRole: docusign.Signer = {
    roleName: "Builder",
    recipientId: "1",
    name: args.builder.name,
    email: args.builder.email,
    routingOrder: "2",
  };
  const ownerRole: docusign.Signer = {
    roleName: "Owner",
    recipientId: "2",
    name: primary.name,
    email: primary.email,
    routingOrder: "1",
    tabs: ownerTabs,
  };

  const envelopeDefinition: docusign.EnvelopeDefinition =
    owners.length <= 1
      ? {
          // Single owner: the known-good templateRoles path (unchanged).
          templateId,
          emailSubject: emailSubject.slice(0, 100),
          templateRoles: [builderRole, ownerRole],
          status: "sent",
        }
      : {
          // Multiple signers: composite = BC4 server template + an inline
          // template assigning Builder + primary Owner (with data tabs) and
          // adding signers 2..N, each a signHere anchored on the single
          // signed_by_owners_value token, stacked by a vertical offset (the BC4
          // form has no per-owner tokens — see contract-template-spec.md).
          emailSubject: emailSubject.slice(0, 100),
          compositeTemplates: [
            {
              serverTemplates: [{ sequence: "1", templateId }],
              inlineTemplates: [
                {
                  sequence: "2",
                  recipients: {
                    signers: [
                      builderRole,
                      ownerRole,
                      ...owners.slice(1).map<docusign.Signer>((signer, index) => ({
                        recipientId: String(index + 3),
                        name: signer.name,
                        email: signer.email,
                        routingOrder: "1",
                        tabs: {
                          signHereTabs: [
                            {
                              anchorString: "signed_by_owners_value",
                              anchorUnits: "pixels",
                              anchorXOffset: "0",
                              anchorYOffset: String(
                                (index + 1) * OWNER_SIGNATURE_STACK_STEP_PX,
                              ),
                              anchorIgnoreIfNotPresent: "true",
                            },
                          ],
                        } as docusign.Tabs,
                      })),
                    ],
                  },
                },
              ],
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

  // Records for EnvelopeSignature. The recipientIds match what we assigned —
  // DocuSign preserves them (template ids Builder=1 / Owner=2; composite uses the
  // explicit ids for signers 2..N) — so the Connect webhook matches by id. We do
  // NOT enrich from listRecipients: signers who fall back to the shared primary
  // email would collide on an email-keyed lookup.
  const recipients: EnvelopeRecipientRecord[] = [
    {
      role: "BUILDER",
      name: args.builder.name,
      email: args.builder.email,
      routingOrder: 2,
      recipientId: "1",
      capacity: null,
      entityName: null,
      entityAbn: null,
    },
    ...owners.map<EnvelopeRecipientRecord>((signer, index) => ({
      role: "CUSTOMER",
      name: signer.name,
      email: signer.email,
      routingOrder: 1,
      recipientId: String(index + 2),
      capacity: signer.capacity ?? null,
      entityName: signer.entityName ?? null,
      entityAbn: signer.entityAbn ?? null,
    })),
  ];

  return { envelopeId: result.envelopeId, recipients };
}
