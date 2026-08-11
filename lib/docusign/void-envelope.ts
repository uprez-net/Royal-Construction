import docusign from "docusign-esign";
import type { DocusignContext } from "./client";

// Void a sent DocuSign envelope so its recipients can no longer sign it — used
// when a superseded revision's Tender/Contract must be pulled back. DocuSign
// caps the voided reason at 200 chars.
export async function voidEnvelope(
  context: DocusignContext,
  envelopeId: string,
  reason: string,
): Promise<void> {
  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  await envelopesApi.update(context.accountId, envelopeId, {
    envelope: {
      status: "voided",
      voidedReason: reason.slice(0, 200),
    } as docusign.Envelope,
  });
}
