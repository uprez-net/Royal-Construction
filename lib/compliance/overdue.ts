import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";

import {
  ARCHITECT_PLANS_BUSINESS_DAYS,
  ARCHITECT_REVISION_BUSINESS_DAYS,
  CONSULTANT_PARTIES,
  documentTypesForParty,
  isNotRequired,
  PARTY_RESPONSE_BUSINESS_DAYS,
} from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  meetingHeldAt,
  outreachForParty,
  outstandingRevision,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
} from "@/types/compliance";

/**
 * Which waits on one compliance file have gone past their quoted turnaround.
 *
 * A pure function over one engagement, deliberately. Everything it decides is
 * a comparison between a stored date and a threshold, and none of it needs the
 * database — so the sweep that runs it nightly across every live job, and the
 * tests that pin the boundaries, can both look at the same code.
 *
 * The other reason it is one function rather than six checks scattered through
 * a cron handler: every one of these conditions has to be able to *close*, and
 * closing is the half that gets forgotten. An alert that outlives its cause is
 * how a panel full of alerts stops being read, and the arrival hooks that close
 * them on the happy path do not cover every route a wait can end by — a
 * surveyor's documents arriving through the classifier, a checklist line being
 * marked not required, a DA taking the planning certificate out of the pack
 * entirely. So each condition is evaluated in full each night and reported as
 * one of raise, resolve, or neither.
 *
 * Nothing here writes. The caller decides what to do with the answer, which is
 * also what makes it safe to call from a dry run.
 */

/** One condition that should be open, and who to go back to about it. */
export type OverdueAlert = {
  type: ComplianceAlertType;
  source: ComplianceAlertSource | null;
  /** The sentence the alert carries — what is late, and by how long. */
  detail: string;
};

export type OverdueAssessment = {
  /** Conditions that are past their threshold and should be open. */
  raise: OverdueAlert[];
  /**
   * Conditions that are no longer true and should be closed.
   *
   * Includes types that were never raised on this file; `resolveComplianceAlert
   * BySystem` is a no-op on those, and filtering them here would mean this
   * function needing to know what is currently open — which is exactly the
   * thing the caller can see and it cannot.
   */
  resolve: { type: ComplianceAlertType; note: string }[];
};

function workingDays(count: number): string {
  return `${count} working day${count === 1 ? "" : "s"}`;
}

/** Whether a document type has something on it, or has been waved off. */
function isSettled(
  engagement: CertifierEngagementDetail,
  documentType: ComplianceDocumentType,
): boolean {
  return engagement.documents.some(
    (document) =>
      document.documentType === documentType &&
      (document.files.length > 0 || isNotRequired(document.status)),
  );
}

/**
 * The wait on one party's opening request.
 *
 * Applies to the surveyor and to both consultants — three parties whose whole
 * engagement is "we asked, they send it back". The architect is deliberately
 * not here: their clock starts at the client meeting rather than at the
 * outreach, because an architect who has not sat with the owners has nothing to
 * draw yet and chasing them for plans would be chasing them for the wrong
 * thing.
 */
function assessPartyResponse(
  engagement: CertifierEngagementDetail,
  party: CompliancePartyType,
  alertType: ComplianceAlertType,
  source: ComplianceAlertSource,
  /** Whether everything this party owes is in. */
  isComplete: boolean,
  now: Date,
): { raise?: OverdueAlert; resolve?: { type: ComplianceAlertType; note: string } } {
  const outreach = outreachForParty(engagement, party);

  // Nobody was written to, or the client supplied the documents themselves.
  // Neither is a party running late; there is nobody waiting on anybody.
  if (
    !outreach ||
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
    !outreach.sentAt
  ) {
    return {
      resolve: { type: alertType, note: "There is nobody outstanding on this." },
    };
  }

  if (isComplete) {
    return {
      resolve: { type: alertType, note: "Their documents came through." },
    };
  }

  const elapsed = businessDaysSince(outreach.sentAt, now);
  if (elapsed <= PARTY_RESPONSE_BUSINESS_DAYS[party]) {
    // Inside their own quoted turnaround. Nothing to raise, and nothing to
    // resolve either — an alert open from a previous run stays open, because
    // the clock only ever moves forward.
    return {};
  }

  return {
    raise: {
      type: alertType,
      source,
      detail: `Engaged ${workingDays(elapsed)} ago and nothing has come back.`,
    },
  };
}

export function assessOverdueConditions(
  engagement: CertifierEngagementDetail,
  now: Date = new Date(),
): OverdueAssessment {
  const raise: OverdueAlert[] = [];
  const resolve: { type: ComplianceAlertType; note: string }[] = [];

  const record = (
    outcome: ReturnType<typeof assessPartyResponse>,
  ) => {
    if (outcome.raise) raise.push(outcome.raise);
    if (outcome.resolve) resolve.push(outcome.resolve);
  };

  // -------------------------------------------------------------------
  // The planning certificate.
  //
  // The only one of these with no thread behind it: the portal is a website,
  // not a correspondent, so this alert says "go and ring the council" rather
  // than offering a one-click chase.
  // -------------------------------------------------------------------
  const application = engagement.planningCertificate;
  const certificateIn = isSettled(
    engagement,
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  );

  if (
    !requiresPlanningCertificate(engagement) ||
    certificateIn ||
    application?.receivedAt
  ) {
    resolve.push({
      type: ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
      note: certificateIn
        ? "The planning certificate is on the file."
        : application?.receivedAt
          ? "The planning certificate came back."
          : "A development application replaced the planning certificate.",
    });
  } else if (application?.appliedAt) {
    const elapsed = businessDaysSince(application.appliedAt, now);
    if (elapsed > PARTY_RESPONSE_BUSINESS_DAYS[CompliancePartyType.COUNCIL]) {
      raise.push({
        type: ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
        source: ComplianceAlertSource.COUNCIL,
        detail: `Lodged ${workingDays(elapsed)} ago${
          application.applicationRef
            ? ` under ${application.applicationRef}`
            : ""
        }, against a quoted three to five.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // The surveyor.
  //
  // Measured against the applicable set rather than the party's whole list, so
  // a job where something has been written off is not permanently overdue for
  // a document nobody is going to send.
  // -------------------------------------------------------------------
  const inPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );
  const surveyorComplete = documentTypesForParty(CompliancePartyType.SURVEYOR)
    .filter((type) => inPlay.has(type))
    .every((type) => isSettled(engagement, type));

  record(
    assessPartyResponse(
      engagement,
      CompliancePartyType.SURVEYOR,
      ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE,
      ComplianceAlertSource.SURVEYOR,
      surveyorComplete,
      now,
    ),
  );

  // -------------------------------------------------------------------
  // The architect, whose two clocks both start at an event rather than at the
  // outreach.
  // -------------------------------------------------------------------
  const architect = outreachForParty(engagement, CompliancePartyType.ARCHITECT);
  const plansIn = isSettled(
    engagement,
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  );
  const heldAt = meetingHeldAt(architect);

  if (plansIn || !heldAt) {
    // No meeting means no clock. That is a deliberate choice rather than an
    // oversight: an architect who has not sat with the owners has nothing to
    // draw, so counting from the outreach would chase them for work they
    // cannot have started. A job where nobody ever books the meeting raises
    // nothing here — the empty architect card is what says so.
    resolve.push({
      type: ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
      note: plansIn
        ? "The preliminary plans are on the file."
        : "No meeting has been held yet, so nothing is outstanding.",
    });
  } else {
    const elapsed = businessDaysSince(heldAt, now);
    if (elapsed > ARCHITECT_PLANS_BUSINESS_DAYS) {
      raise.push({
        type: ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
        source: ComplianceAlertSource.ARCHITECT,
        detail: `The client and architect met ${workingDays(elapsed)} ago and no preliminary plans have followed.`,
      });
    }
  }

  const revision = outstandingRevision(architect);
  if (!revision) {
    resolve.push({
      type: ComplianceAlertType.ARCHITECT_REVISION_OVERDUE,
      note: "There are no revisions outstanding with the architect.",
    });
  } else {
    const elapsed = businessDaysSince(revision.requestedAt, now);
    if (elapsed > ARCHITECT_REVISION_BUSINESS_DAYS) {
      raise.push({
        type: ComplianceAlertType.ARCHITECT_REVISION_OVERDUE,
        source: ComplianceAlertSource.ARCHITECT,
        detail: `The client's revisions went across ${workingDays(elapsed)} ago and no revised set has come back.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // The consultants.
  //
  // "Complete" here is the checklist line they were engaged against, not a
  // document type: the whole point of the arrangement is that what they send
  // answers that line. A consultant engaged against an item somebody has since
  // marked not required is finished with, which is why `isNotRequired` counts.
  // -------------------------------------------------------------------
  for (const party of CONSULTANT_PARTIES) {
    const outreach = outreachForParty(engagement, party);
    const target = outreach?.checklistDocumentId
      ? engagement.documents.find(
          (document) => document.id === outreach.checklistDocumentId,
        )
      : undefined;

    // A row that has gone — a checklist re-extracted since the outreach —
    // reads as settled rather than as permanently outstanding. There is
    // nothing on screen to chase against, so an alert would point nowhere.
    const isComplete =
      !target || target.files.length > 0 || isNotRequired(target.status);

    record(
      assessPartyResponse(
        engagement,
        party,
        party === CompliancePartyType.BASIX_CONSULTANT
          ? ComplianceAlertType.BASIX_RESPONSE_OVERDUE
          : ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE,
        party === CompliancePartyType.BASIX_CONSULTANT
          ? ComplianceAlertSource.BASIX_CONSULTANT
          : ComplianceAlertSource.BUSHFIRE_CONSULTANT,
        isComplete,
        now,
      ),
    );
  }

  return { raise, resolve };
}
