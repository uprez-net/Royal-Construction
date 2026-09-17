// One Undo toast per list. Each delete captures the index it removed from, and
// Sonner stacks toasts, so two pending Undos restored their rows against a list
// that had changed under them and landed in the wrong order. A toast re-using
// an id replaces the one on screen, so only the latest delete in a list is
// undoable, and its index is still the current one.
export const COST_SCHEDULE_UNDO_TOAST_ID = "admin-undo-cost-schedule-row";
export const ALLOWANCE_UNDO_TOAST_ID = "admin-undo-offer-scope-allowance";
export const EXCLUSION_UNDO_TOAST_ID = "admin-undo-offer-scope-exclusion";
export const INCLUSION_BULLET_UNDO_TOAST_ID =
  "admin-undo-offer-content-inclusion-bullet";
export const EXCLUSION_BULLET_UNDO_TOAST_ID =
  "admin-undo-offer-content-exclusion-bullet";
export const INCLUSION_SCHEDULE_UNDO_TOAST_ID =
  "admin-undo-inclusion-schedule-row";
