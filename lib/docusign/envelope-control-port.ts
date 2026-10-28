import { createDocusignContext } from "@/lib/docusign/client";
import { getDocusignConfig } from "@/lib/docusign/config";
import { getEnvelopeStatus, voidEnvelope } from "@/lib/docusign/void-envelope";
import type { EnvelopeControlPort } from "@/lib/domain/ports/envelope-control";

/**
 * DocuSign behind the domain's envelope-control port, for a recall or a
 * revision that has to void a live envelope first.
 *
 * The app and Eve both use this one. Eve used to get a stand-in that threw,
 * so an agent recall of a document out for signature always failed, and its
 * revision refused whenever an envelope was live.
 *
 * The DocuSign context is created on first use, so a call that never needs
 * DocuSign never authenticates.
 */
export function createDocusignEnvelopeControl(): EnvelopeControlPort {
  let context: ReturnType<typeof createDocusignContext> | null = null;
  const getContext = () => {
    context ??= createDocusignContext(getDocusignConfig());
    return context;
  };
  return {
    getStatus: async (envelopeId) =>
      getEnvelopeStatus(await getContext(), envelopeId),
    void: async (envelopeId, reason) =>
      voidEnvelope(await getContext(), envelopeId, reason),
  };
}
