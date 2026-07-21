import { buildProposalInput } from "./offer-proposal-input";
import {
  deserializeWorkspace,
  parseWorkspaceState,
} from "./workspace-persistence";

// Resolve the inc-GST price of record for one offer revision.
//
// The stored Offer.contractValueIncGst column used to be written from the
// OPTIONAL manual price override, which is 0 cents whenever the estimator priced
// the offer the normal way — so historical rows carry a $0 that never matched the
// document the client received. saveOfferWorkspace now writes the resolved price,
// but rows saved before that fix are still wrong and no migration can recompute
// them outside the workspace schema. Deriving from the revision's own saved
// workspaceState repairs those rows on read, and it stays correct for a forked
// revision that has not been re-saved yet.
//
// Returns null — rendered as "—" — rather than a confident $0 when there is
// nothing to price against. A real home-build contract is never $0, so an
// unpriced revision must not be shown as a $0 quote.
export function resolveOfferContractValue(
  storedValue: number | null,
  workspaceState: unknown,
): number | null {
  // A positive stored value is authoritative: it is what the save recorded, and
  // recomputing it would drift if the pricing rules ever change under a revision
  // that was already sent to the client.
  if (storedValue !== null && storedValue > 0) {
    return storedValue;
  }

  if (workspaceState === null || workspaceState === undefined) {
    return null;
  }

  try {
    const snapshot = deserializeWorkspace(parseWorkspaceState(workspaceState));
    const derived =
      buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
    return derived > 0 ? derived : null;
  } catch {
    // A workspaceState from a retired schema (or a corrupted row) must not take
    // the whole Versions timeline down — this is a display-only derivation.
    return null;
  }
}
