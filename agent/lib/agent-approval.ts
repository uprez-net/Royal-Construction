import type { ApprovalResponsePolicy } from "eve/tools/approval";
import { always } from "eve/tools/approval";

const ownerMayApprove: ApprovalResponsePolicy = ({ responder, session }) => {
  const owner = session.initiator;
  return owner?.principalType === "user" &&
    responder.principalType === "user" &&
    responder.principalId === owner.principalId
    ? { status: "allowed" }
    : {
        status: "rejected",
        reason: "Only the owner of this agent session can approve the action.",
      };
};

/** Require a fresh approval whose responder is the permanent session owner. */
export function ownerOnlyApproval() {
  return {
    request: always(),
    response: ownerMayApprove,
  };
}
