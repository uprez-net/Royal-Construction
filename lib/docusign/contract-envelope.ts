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

export interface CreateContractEnvelopeArgs {
  readonly context: DocusignContext;
  readonly config: DocusignConfig;
  readonly templateId: string;
  readonly emailSubject: string;
  readonly builder: { readonly name: string; readonly email: string };
  // Ordered customer-side signers, primary first (collectOfferSigners order).
  // The PRIMARY signs the BC4 form's owner line + carries all data tabs. Signers
  // 2..N sign the appended "Owner Signature Schedule" annexure (annexurePdfBase64)
  // — the single BC4 owner area only fits ~2 signatures before the Builder block,
  // so co-owners/directors go on a clean generated page (ADR 0003). N=1 uses the
  // plain templateRoles path (no annexure).
  readonly owners: readonly ContractOwnerSigner[];
  // The "Owner Signature Schedule" PDF (base64) — required when owners.length > 1;
  // its sigAnnex{k}/dateAnnex{k} anchors receive signers 2..N's signature tabs.
  readonly annexurePdfBase64?: string | null;
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
          // Multiple signers, two composite layers (ADR 0003):
          //   1) the BC4 server template with Builder + primary Owner (data tabs);
          //   2) an inline layer that ADDS the Owner Signature Schedule as
          //      document 2 and signers 2..N, each anchored on the schedule's
          //      sigAnnex{k}/dateAnnex{k} tokens.
          // The document must be its own composite layer — a document placed in the
          // server-template layer's inline template is silently dropped (verified).
          emailSubject: emailSubject.slice(0, 100),
          compositeTemplates: [
            {
              serverTemplates: [{ sequence: "1", templateId }],
              inlineTemplates: [
                { sequence: "2", recipients: { signers: [builderRole, ownerRole] } },
              ],
            },
            {
              inlineTemplates: [
                {
                  sequence: "1",
                  ...(args.annexurePdfBase64
                    ? {
                        documents: [
                          {
                            documentBase64: args.annexurePdfBase64,
                            name: "Owner-Signature-Schedule.pdf",
                            fileExtension: "pdf",
                            documentId: "2",
                          },
                        ],
                      }
                    : {}),
                  recipients: {
                    signers: owners.slice(1).map<docusign.Signer>((signer, index) => {
                      const k = index + 1;
                      return {
                        recipientId: String(index + 3),
                        // roleName lets us map DocuSign's re-numbered recipientId
                        // back to this signer's capacity/entity on readback.
                        roleName: `AnnexOwner${k}`,
                        name: signer.name,
                        email: signer.email,
                        routingOrder: "1",
                        tabs: {
                          signHereTabs: [
                            {
                              anchorString: `sigAnnex${k}`,
                              anchorUnits: "pixels",
                              anchorXOffset: "0",
                              anchorYOffset: "-8",
                              // Fail loud if the schedule anchor is missing, rather
                              // than silently leaving a signer with no signature tab.
                              anchorIgnoreIfNotPresent: "false",
                            },
                          ],
                          dateSignedTabs: [
                            {
                              anchorString: `dateAnnex${k}`,
                              anchorUnits: "pixels",
                              anchorXOffset: "0",
                              anchorYOffset: "-3",
                              anchorIgnoreIfNotPresent: "false",
                            },
                          ],
                        } as docusign.Tabs,
                      };
                    }),
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

  // Composite templates re-number recipientIds, so read the actual recipients
  // back and map our capacity/entity onto them by roleName (Builder / Owner /
  // AnnexOwner{k}). The recorded recipientId then matches what the Connect webhook
  // reports, so per-signer status updates land on the right EnvelopeSignature.
  const recipients: EnvelopeRecipientRecord[] = [];
  try {
    const list = await envelopesApi.listRecipients(
      context.accountId,
      result.envelopeId,
      {},
    );
    for (const signer of list.signers ?? []) {
      const roleName = (signer.roleName ?? "").toLowerCase();
      let role: "BUILDER" | "CUSTOMER" = "CUSTOMER";
      let source: ContractOwnerSigner | undefined;
      if (roleName === "builder") {
        role = "BUILDER";
      } else if (roleName === "owner") {
        source = owners[0];
      } else if (roleName.startsWith("annexowner")) {
        source = owners[Number(roleName.slice("annexowner".length))];
      }
      recipients.push({
        role,
        name: signer.name ?? source?.name ?? "",
        email: signer.email ?? source?.email ?? "",
        routingOrder: Number(signer.routingOrder ?? (role === "BUILDER" ? 2 : 1)),
        recipientId: signer.recipientId ?? "",
        capacity: source?.capacity ?? null,
        entityName: source?.entityName ?? null,
        entityAbn: source?.entityAbn ?? null,
      });
    }
  } catch {
    // Non-fatal: the Connect webhook can still match recipients by email.
  }
  // Defensive: if the readback returned nothing, record our intended set (the
  // webhook then matches by email) so no signer is lost from the audit trail.
  if (recipients.length === 0) {
    recipients.push({
      role: "BUILDER",
      name: args.builder.name,
      email: args.builder.email,
      routingOrder: 2,
      recipientId: "1",
      capacity: null,
      entityName: null,
      entityAbn: null,
    });
    owners.forEach((signer, index) =>
      recipients.push({
        role: "CUSTOMER",
        name: signer.name,
        email: signer.email,
        routingOrder: 1,
        recipientId: String(index + 2),
        capacity: signer.capacity ?? null,
        entityName: signer.entityName ?? null,
        entityAbn: signer.entityAbn ?? null,
      }),
    );
  }

  return { envelopeId: result.envelopeId, recipients };
}
