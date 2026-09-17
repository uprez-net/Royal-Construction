import type { RecallScope } from "./offer-workflow-transitions";
import type { OfferWorkspaceStatus } from "./workspace-model";

// Which lifecycle action is running. Status changes, recalls and revisions share
// one guard in the workspace, which drops a second click while the first runs,
// but the buttons never showed it: a click on another lifecycle button looked
// accepted and did nothing. Every lifecycle button now disables while one runs,
// and the one that started it reports aria-busy.
//
// A transition is named by its target status; a recall by the document it voids,
// since a recall's target status is also a plain transition's.
export type LifecycleAction =
  | OfferWorkspaceStatus
  | `recall-${RecallScope}`
  | "revision";

export function lifecycleActionFor(
  next: OfferWorkspaceStatus,
  recallScope?: RecallScope,
): LifecycleAction {
  return recallScope ? `recall-${recallScope}` : next;
}
