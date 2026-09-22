// Looking an envelope up by the send-attempt marker stamped on it, as a
// capability the domain is handed rather than a provider it imports.
//
// The search itself needs the DocuSign API client and pages through
// `listStatusChanges`; that implementation stays in
// `lib/docusign/envelope-send-attempt.ts`. What the domain needs is the
// ANSWER, and specifically that the answer has three shapes, not two.

/**
 * The outcome of looking for an envelope by its send-attempt marker.
 *
 * `"not-found"` and `"incomplete"` have to be different answers, and this is
 * the load-bearing part of the type. `listStatusChanges` is paginated, so
 * reading one page and reporting nothing is a false negative — and the one
 * branch that acts without a human, the reconcile job's not-found branch,
 * responds to it by resolving the record and unblocking a recall on an offer
 * whose envelope was simply on page two. Only a search that reached a proven
 * end of the result set may say `"not-found"`.
 */
export type EnvelopeSearchResult =
  | { readonly kind: "found"; readonly envelopeId: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "incomplete"; readonly reason: string };

/**
 * Find the envelope an attempt produced, if DocuSign received the create call.
 *
 * `since` is the moment the attempt started; implementations use it to bound
 * the search window.
 */
export type EnvelopeSearchPort = (input: {
  readonly sendAttemptId: string;
  readonly since: Date;
}) => Promise<EnvelopeSearchResult>;
