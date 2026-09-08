import {
  ComplianceAlertType,
  ComplianceDocumentType,
  CompliancePartyType,
} from "@prisma/client";

import {
  complianceDocumentLabel,
  documentTypesForParty,
  isConsultantParty,
  PARTY_LABEL,
  PARTY_PREREQUISITES,
} from "@/constants/complianceDocuments";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  hasOpenAlert,
  isPartyEngaged,
  outreachForParty,
  type CertifierEngagementDetail,
} from "@/types/compliance";

/**
 * Why a party cannot be engaged yet, in the reader's own terms, or null.
 *
 * One module, imported by the tab and by the data layer both. The two used to
 * hold near-identical copies of this — `blockedReason` in
 * project-compliance-tab.tsx and `partyPrerequisiteFailure` in
 * lib/data/compliance-outreach.ts — and near-identical is the problem: a button
 * that offers a send the server then refuses, and a section the server would
 * unlock that the tab keeps shut, are the same bug read from two ends. It is a
 * plain module with no `"use server"` so both sides can genuinely share it.
 *
 * A sentence rather than a boolean because the reasons are different moves.
 * "Nobody has engaged the surveyor" is something to go and do; "the surveyor
 * still owes us two documents" is something to wait for or chase on the thread;
 * "order the planning certificate" is a third thing again, and the reader has
 * to be told which.
 */

/**
 * Whether the council side of the file is settled.
 *
 * The council is the one party with nobody to engage and no mail to send, so
 * "have we dealt with them" cannot be `isPartyEngaged` — an outreach row is
 * written when an application is lodged, but a builder who already held a
 * current certificate never lodges one, and gating on the row would block them
 * over a step they had correctly skipped. What settles it is the certificate
 * being on the file, which is the same thing either route arrives at.
 *
 * An open DA alert settles it too, and for a reason worth stating: on a job
 * that needs development approval the 10.7 certificate is not merely late, it
 * is not wanted. Blocking the architect on a document the rest of the tab has
 * written off would strand the file exactly when it most needs redrawing.
 */
export function isCouncilSettled(
  engagement: Pick<CertifierEngagementDetail, "documents" | "alerts">,
): boolean {
  if (hasOpenAlert(engagement, ComplianceAlertType.DA_APPROVAL_REQUIRED)) {
    return true;
  }
  return engagement.documents.some(
    (document) =>
      document.documentType ===
        ComplianceDocumentType.PLANNING_CERTIFICATE_10_7 &&
      document.files.length > 0,
  );
}

/** The required documents one party still owes, ignoring ones this file has written off. */
function outstandingFor(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
): ComplianceDocumentType[] {
  // Filtered through the applicable set rather than the party's whole list: a
  // DA takes the 10.7 certificate out of the pack, and a prerequisite that
  // still demanded it would hold the architect behind a document nobody is
  // going to supply.
  const inPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );

  return documentTypesForParty(party).filter(
    (type) =>
      inPlay.has(type) &&
      !engagement.documents.some(
        (document) =>
          document.documentType === type && document.files.length > 0,
      ),
  );
}

export function partyBlockedReason(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
): string | null {
  // A consultant is not gated on another party at all — it is gated on a
  // checklist line existing that asks for what they produce, which the row
  // offering the control has already established by being on screen.
  if (isConsultantParty(party)) {
    return null;
  }

  for (const prerequisite of PARTY_PREREQUISITES[party]) {
    const upstreamLabel = PARTY_LABEL[prerequisite].toLowerCase();

    if (prerequisite === CompliancePartyType.COUNCIL) {
      // Said as an instruction rather than as a wait. Nobody is coming with
      // this one: somebody has to go to the portal and buy it, and "waiting on
      // the planning certificate" reads as though that is already happening.
      if (!isCouncilSettled(engagement)) {
        return "Order the 10.7(2) & (5) planning certificate first — the architect needs it to know what the lot can carry.";
      }
      continue;
    }

    if (!isPartyEngaged(engagement, prerequisite)) {
      return `Engage the ${upstreamLabel} first — this unlocks once their documents are in.`;
    }

    const outstanding = outstandingFor(engagement, prerequisite);
    if (outstanding.length > 0) {
      return `Waiting on ${outstanding
        .map((type) => complianceDocumentLabel(type))
        .join(" and ")} from the ${upstreamLabel}.`;
    }
  }

  return null;
}

/**
 * Whether the client has signed off on the architect's preliminary plans.
 *
 * The gate on sending anything to the certifier. A pack built on plans the
 * client has not seen is a pack that comes back — the certifier assesses it,
 * the client then asks for a change, and the assessment was of a design that no
 * longer exists.
 *
 * True where there is no architect outreach at all, which is the client having
 * arrived with their own drawings: they are the client, they have approved them
 * by supplying them, and there is nobody to have asked.
 */
export function clientHasApprovedPlans(
  engagement: CertifierEngagementDetail,
): boolean {
  const architect = outreachForParty(
    engagement,
    CompliancePartyType.ARCHITECT,
  );
  if (!architect) return true;
  return architect.clientPlansApprovedAt !== null;
}

/**
 * Why the required pack cannot go to the certifier, or null.
 *
 * Three conditions, and they are all about the pack being wrong rather than
 * incomplete — what is missing is already said by the rows themselves and by
 * `missingOutreachDocuments`. These are the cases where every row is full and
 * the pack still must not go.
 *
 * Read by the send button and by `sendCertifierOutreach`, so the button and the
 * server cannot disagree about whether the send is allowed.
 */
export function packSendBlockedReason(
  engagement: CertifierEngagementDetail,
): string | null {
  if (hasOpenAlert(engagement, ComplianceAlertType.STALE_TITLE_SEARCH)) {
    // The strongest of the three. A title search naming the previous owners is
    // not a document with a problem, it is the wrong document: sending it opens
    // the engagement on a certifier's assessment of somebody else's land, and
    // every hour that assessment runs is an hour wasted.
    return "The title search does not name the current owners. Send it once a replacement has been supplied and checked.";
  }

  if (!clientHasApprovedPlans(engagement)) {
    return "The client has not approved the preliminary plans yet. Record their answer on the architect block first.";
  }

  return null;
}
