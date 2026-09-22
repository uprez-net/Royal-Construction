/**
 * Provider capability for creating a signing envelope.
 *
 * The request and result stay generic so DocuSign SDK types remain in the App
 * adapter. Domain code owns the claim and persistence discipline; this port
 * makes the irreversible provider edge explicit and replaceable.
 */
export type EnvelopeSendPort<TRequest, TEnvelope> = {
  readonly send: (request: TRequest) => Promise<TEnvelope>;
};
