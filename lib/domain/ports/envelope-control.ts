/**
 * The provider operations needed to pull a signing envelope back.
 *
 * Domain code owns when a document may be recalled or superseded; the adapter
 * owns how DocuSign is reached. Keeping that split explicit also lets Eve call
 * the same command while honestly reporting that a live envelope needs the App
 * (or a human) when no provider port is available in its runtime.
 */
export type EnvelopeControlPort = {
  readonly void: (envelopeId: string, reason: string) => Promise<void>;
  readonly getStatus: (envelopeId: string) => Promise<string | null>;
};
