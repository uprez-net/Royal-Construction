import type {
  AdminOfferContentSection,
  AdminOfferContentState,
} from "./admin-offer-content-hydrate";

// Kept free of the slice and its server actions so the save rules can be tested
// without loading Prisma. The helpers mutate, so the slice calls them on its
// Immer draft.

// A save sends a snapshot and the editors stay live while it is in flight, so
// the admin can keep typing, or press Undo on a delete toast, before it
// resolves. Every edit bumps the section's revision; a save only marks the
// section clean if nothing was edited after its snapshot was taken. Otherwise
// those newer edits would read as saved: Save would disable, closing the tab
// would not warn, and the next page mount would replace them with the server
// copy.
export function markSectionEdited(
  state: Pick<AdminOfferContentState, "dirty" | "error" | "revision">,
  section: AdminOfferContentSection,
): void {
  state.dirty[section] = true;
  state.error[section] = null;
  state.revision[section] += 1;
}

export interface AdminSaveReceipt {
  sentRevision: number;
  // The save stored what it sent, but the admin edited the section meanwhile.
  newerEdits: boolean;
}

export function saveReceipt(
  state: Pick<AdminOfferContentState, "revision">,
  section: AdminOfferContentSection,
  sentRevision: number,
): AdminSaveReceipt {
  return { sentRevision, newerEdits: state.revision[section] !== sentRevision };
}

export function settleSavedSection(
  state: Pick<AdminOfferContentState, "dirty" | "saving" | "revision">,
  section: AdminOfferContentSection,
  sentRevision: number,
): void {
  state.saving[section] = false;
  if (!saveReceipt(state, section, sentRevision).newerEdits) {
    state.dirty[section] = false;
  }
}
