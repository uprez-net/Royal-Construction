import type { AdminOfferContent } from "@/types/admin-offer-content";

// Kept free of the slice and its server actions so the merge rule can be tested
// without loading Prisma.

export type AdminOfferContentSection =
  | "buildScope"
  | "costSchedule"
  | "offerScope"
  | "offerContent"
  | "hbfcClaim";

export interface AdminOfferContentState {
  data: AdminOfferContent;
  dirty: Record<AdminOfferContentSection, boolean>;
  saving: Record<AdminOfferContentSection, boolean>;
  error: Record<AdminOfferContentSection, string | null>;
  // Local edit counter per section; see admin-offer-content-save.ts.
  revision: Record<AdminOfferContentSection, number>;
}

// The admin page hydrates the store from its server props on every mount, and
// the store outlives the page. Replacing everything therefore threw away unsaved
// edits whenever an admin navigated away and back, while Save went quiet as if
// nothing had been lost. A section with unsaved edits keeps them (and its
// saving/error flags); only clean sections take the server copy. `version` is
// the server's counter, never a local one.
export function mergeHydratedAdminContent(
  state: AdminOfferContentState,
  payload: AdminOfferContent,
): AdminOfferContentState {
  const pick = <K extends AdminOfferContentSection>(
    section: K,
  ): AdminOfferContent[K] =>
    state.dirty[section] ? state.data[section] : payload[section];

  const errorFor = (section: AdminOfferContentSection) =>
    state.dirty[section] ? state.error[section] : null;

  return {
    data: {
      ...payload,
      buildScope: pick("buildScope"),
      costSchedule: pick("costSchedule"),
      offerScope: pick("offerScope"),
      offerContent: pick("offerContent"),
      hbfcClaim: pick("hbfcClaim"),
    },
    dirty: { ...state.dirty },
    // In-flight saves settle through their own thunk; the payload knows nothing
    // about them.
    saving: { ...state.saving },
    // An in-flight save compares against these counters when it settles, so a
    // remount must not reset them.
    revision: { ...state.revision },
    error: {
      buildScope: errorFor("buildScope"),
      costSchedule: errorFor("costSchedule"),
      offerScope: errorFor("offerScope"),
      offerContent: errorFor("offerContent"),
      hbfcClaim: errorFor("hbfcClaim"),
    },
  };
}
