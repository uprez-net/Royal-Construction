// Which offer statuses show Contract terms, and whether the BC4 has gone out by
// then. Apart from contract-terms.ts, which pulls in the proposal and pricing
// modules, so the workspace can ask without bundling them. Either case of status
// is accepted: the server has OfferStatus, the workspace its lowercase form.

// Before the BC4 is sent, the terms are resolved the way the send resolves them.
const UNSENT_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  "TENDER_SIGNED",
  "CONTRACT_DRAFT",
]);

// After it is sent, the Contract row holds the tab values the customer received.
const SENT_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "CONTRACT_DECLINED",
  "PROJECT",
]);

export function hasContractTerms(status: string): boolean {
  const key = status.toUpperCase();
  return UNSENT_CONTRACT_STATUSES.has(key) || SENT_CONTRACT_STATUSES.has(key);
}

export function isContractSentStatus(status: string): boolean {
  return SENT_CONTRACT_STATUSES.has(status.toUpperCase());
}
