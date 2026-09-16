// The offer workspace's autosave state, as the command bar shows it.
//
// "reconciled": a save found the offer had moved on in another tab (edited,
// issued or revised there), and the workspace reloaded the saved copy. Nothing
// here is waiting to be saved, but the estimator's last edit may have been
// replaced, which is news worth showing and is not a failure.
export type OfferSaveState = "idle" | "saving" | "saved" | "error" | "reconciled";

// Whether closing the tab now could lose work. The unload guard used to watch
// only "saving", so a tab whose save had failed closed without a prompt and its
// unsaved edits went with it.
export function isUnsafeToLeave(state: OfferSaveState): boolean {
  return state === "saving" || state === "error";
}
