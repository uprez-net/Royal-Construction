import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";

import { BUSHFIRE_REVISION_BUSINESS_DAYS } from "@/constants/complianceDevelopers";
import {
  ARCHITECT_PLANS_BUSINESS_DAYS,
  ARCHITECT_REVISION_BUSINESS_DAYS,
  CONSULTANT_PARTIES,
  documentTypesForParty,
  EXTERNAL_APPLICATION_COPY,
  EXTERNAL_APPLICATION_DOCUMENT_TYPE,
  isNotRequired,
  PARTY_RESPONSE_BUSINESS_DAYS,
  WASTE_MANAGEMENT_BUSINESS_DAYS,
} from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  externalApplication,
  meetingHeldAt,
  outreachForParty,
  outstandingRevision,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
  type ComplianceDocumentWithFiles,
  type ComplianceOutreachDetail,
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

/**
 * The alert and the source each consultant's silence is reported under.
 *
 * A table rather than the pair of ternaries this was when there were two
 * consultants. At five they stop being readable, and the failure mode of
 * getting one wrong is quiet: a bushfire assessor going overdue under the
 * BASIX alert, which the panel then describes as a certificate nobody ordered.
 */
const CONSULTANT_ALERT: Readonly<
  Record<CompliancePartyType, ComplianceAlertType>
> = {
  [CompliancePartyType.BASIX_CONSULTANT]:
    ComplianceAlertType.BASIX_RESPONSE_OVERDUE,
  [CompliancePartyType.BUSHFIRE_CONSULTANT]:
    ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE,
  [CompliancePartyType.STRUCTURAL_ENGINEER]:
    ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE,
  [CompliancePartyType.WATER_AUTHORITY]:
    ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE,
  [CompliancePartyType.TRAFFIC_CONSULTANT]:
    ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE,
  // The three engaged off the required pack have their own clocks above, and a
  // consultant loop never reaches them. Listed so the record stays exhaustive
  // over the enum, which is what makes a sixth consultant a compile error here
  // rather than one that silently raises nothing.
  [CompliancePartyType.SURVEYOR]: ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE,
  [CompliancePartyType.ARCHITECT]: ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
  [CompliancePartyType.COUNCIL]:
    ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
  // Not a consultant either, and for a different reason: they produce nothing,
  // so "have they answered" is a verdict on the row rather than a document on
  // the file. Their clock is its own block below.
  [CompliancePartyType.DEVELOPER]:
    ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
};

const CONSULTANT_ALERT_SOURCE: Readonly<
  Record<CompliancePartyType, ComplianceAlertSource>
> = {
  [CompliancePartyType.BASIX_CONSULTANT]: ComplianceAlertSource.BASIX_CONSULTANT,
  [CompliancePartyType.BUSHFIRE_CONSULTANT]:
    ComplianceAlertSource.BUSHFIRE_CONSULTANT,
  [CompliancePartyType.STRUCTURAL_ENGINEER]:
    ComplianceAlertSource.STRUCTURAL_ENGINEER,
  [CompliancePartyType.WATER_AUTHORITY]: ComplianceAlertSource.WATER_AUTHORITY,
  [CompliancePartyType.TRAFFIC_CONSULTANT]:
    ComplianceAlertSource.TRAFFIC_CONSULTANT,
  [CompliancePartyType.DEVELOPER]: ComplianceAlertSource.DEVELOPER,
  [CompliancePartyType.SURVEYOR]: ComplianceAlertSource.SURVEYOR,
  [CompliancePartyType.ARCHITECT]: ComplianceAlertSource.ARCHITECT,
  [CompliancePartyType.COUNCIL]: ComplianceAlertSource.COUNCIL,
};

/**
 * The checklist lines one outreach was raised against, as rows on the file.
 *
 * Read off the deliverables table, which is the whole reason that table exists:
 * a structural engineer answers three lines off one engagement, and the single
 * `checklistDocumentId` column it replaced could only ever name one of them. A
 * job holding the structural drawings and three weeks overdue on the
 * geotechnical report read, through that column, as finished with them.
 *
 * Falls back to the column for the consultants engaged before the table
 * existed, and for the rows the backfill could not reach.
 *
 * Rows that have gone are dropped rather than counted as outstanding — a
 * checklist re-extracted since the outreach rewrites its items, and an alert
 * against a line nobody can see is an alert pointing nowhere.
 */
function deliverableTargets(
  engagement: CertifierEngagementDetail,
  outreach: ComplianceOutreachDetail | undefined,
): ComplianceDocumentWithFiles[] {
  if (!outreach) return [];

  const ids = new Set(
    outreach.deliverables
      .map((deliverable) => deliverable.checklistDocumentId)
      .filter((id): id is string => id !== null),
  );
  if (ids.size === 0 && outreach.checklistDocumentId) {
    ids.add(outreach.checklistDocumentId);
  }

  return engagement.documents.filter((document) => ids.has(document.id));
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
  // The applications to outside bodies.
  //
  // The five with no thread behind them: a portal is a website, not a
  // correspondent, so each of these alerts says "ring them with the reference
  // number" rather than offering a one-click chase.
  //
  // One loop over the kinds rather than five blocks, because they differ only
  // in their threshold and their document. The 10.7 certificate used to be the
  // whole of this section and is now one row of the table it turned into.
  // -------------------------------------------------------------------
  for (const kind of Object.values(ComplianceExternalApplicationKind)) {
    const copy = EXTERNAL_APPLICATION_COPY[kind];
    const application = externalApplication(engagement, kind);
    const documentType = EXTERNAL_APPLICATION_DOCUMENT_TYPE[kind];
    const documentIn = documentType
      ? isSettled(engagement, documentType)
      : false;

    // Whether this file wants the thing at all.
    //
    // Only the 10.7 has an answer other than yes, and only in one direction:
    // once a development application is under way the certifier is no longer
    // being asked to assess a CDC, so the certificate is not part of the pack.
    // It is still wanted for the DA itself -- see `requiresPlanningCertificate`
    // -- which is why an application actually lodged keeps its clock running.
    // What stops is chasing a certificate nobody ever ordered.
    const wanted =
      kind !== ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7 ||
      requiresPlanningCertificate(engagement) ||
      Boolean(application?.appliedAt);

    if (!wanted || documentIn || application?.receivedAt) {
      resolve.push({
        type: copy.alertType,
        note: documentIn
          ? `${copy.label} is on the file.`
          : application?.receivedAt
            ? `${copy.label} came back.`
            : `${copy.label} is not part of this job.`,
      });
      continue;
    }

    if (!application?.appliedAt) {
      // Nothing lodged means no clock. Not resolved either: an alert raised on
      // a previous run stays open, because the clock only moves forward and an
      // admin clearing a lodgement date is not the wait ending.
      continue;
    }

    const elapsed = businessDaysSince(application.appliedAt, now);
    if (elapsed > copy.businessDays) {
      raise.push({
        type: copy.alertType,
        source: ComplianceAlertSource.COUNCIL,
        detail: `Lodged ${workingDays(elapsed)} ago${
          application.applicationRef
            ? ` under ${application.applicationRef}`
            : ""
        }, against a quoted ${copy.turnaround}.`,
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

    // Every line this party was asked to answer, not one.
    //
    // A structural engineer answers three, and reading only the first meant a
    // job holding the structural drawings and waiting three weeks on the
    // geotechnical report read as finished with them. Falls back to the single
    // column for the consultants engaged before the deliverables table existed.
    const targets = deliverableTargets(engagement, outreach);

    // Complete when every line it was raised against is settled. A row that has
    // gone — a checklist re-extracted since the outreach — is not among them:
    // there is nothing on screen to chase against, so an alert would point
    // nowhere. A party with no lines at all is likewise finished with, which is
    // what an engagement raised off the development application looks like.
    const isComplete = targets.every(
      (target) => target.files.length > 0 || isNotRequired(target.status),
    );

    record(
      assessPartyResponse(
        engagement,
        party,
        CONSULTANT_ALERT[party],
        CONSULTANT_ALERT_SOURCE[party],
        isComplete,
        now,
      ),
    );
  }

  // -------------------------------------------------------------------
  // The estate developer, and the rework a refusal from them causes.
  //
  // Two clocks on one report, and they are never both running: the first is the
  // wait on a verdict, the second is the wait on a consultant to answer it.
  // Separate types because at most one alert of a type is open per file, and
  // "waiting on the developer" and "waiting on the consultant to redo it" want
  // different chases sent to different people.
  // -------------------------------------------------------------------
  const developer = outreachForParty(engagement, CompliancePartyType.DEVELOPER);

  if (!developer || !developer.sentAt || developer.approvalDecision) {
    // Nobody asked, or they have answered. A rejection counts as answered: the
    // wait has moved to the consultant, and chasing a developer who has already
    // told us no is the alert pointing at the wrong party.
    resolve.push({
      type: ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
      note: developer?.approvalDecision
        ? "The developer has given their answer."
        : "Nobody is waiting on a developer approval.",
    });
  } else {
    const elapsed = businessDaysSince(developer.sentAt, now);
    if (elapsed > PARTY_RESPONSE_BUSINESS_DAYS[CompliancePartyType.DEVELOPER]) {
      raise.push({
        type: ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
        source: ComplianceAlertSource.DEVELOPER,
        detail: `The bushfire report went to them ${workingDays(elapsed)} ago and no decision has come back.`,
      });
    }
  }

  // The rework, measured off the revision round the refusal opened rather than
  // off the consultant's original engagement — which was months earlier, and
  // would have this past its threshold on the day the developer said no.
  const bushfireRevision = outstandingRevision(
    outreachForParty(engagement, CompliancePartyType.BUSHFIRE_CONSULTANT),
  );

  if (!bushfireRevision) {
    resolve.push({
      type: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
      note: "There is no bushfire report outstanding for revision.",
    });
  } else {
    const elapsed = businessDaysSince(bushfireRevision.requestedAt, now);
    if (elapsed > BUSHFIRE_REVISION_BUSINESS_DAYS) {
      raise.push({
        type: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
        source: ComplianceAlertSource.DEVELOPER,
        detail: `The developer's reasons went to the consultant ${workingDays(elapsed)} ago and no revised report has come back.`,
      });
    }
  }

  // -------------------------------------------------------------------
  // The waste management plan.
  //
  // The architect's third clock, and the only one measured from a request
  // rather than from an event or an engagement. It has to be: the plan is asked
  // for off a checklist line or off the development application, often months
  // after the outreach that engaged them, and an SLA read off that outreach
  // would be past on the day it was requested.
  // -------------------------------------------------------------------
  const wasteRequestedAt = architect?.wasteManagementRequestedAt ?? null;
  const wastePlanIn = isSettled(
    engagement,
    ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
  );

  if (!wasteRequestedAt || wastePlanIn) {
    resolve.push({
      type: ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE,
      note: wastePlanIn
        ? "The waste management plan is on the file."
        : "Nobody has been asked for a waste management plan.",
    });
  } else {
    const elapsed = businessDaysSince(wasteRequestedAt, now);
    if (elapsed > WASTE_MANAGEMENT_BUSINESS_DAYS) {
      raise.push({
        type: ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE,
        source: ComplianceAlertSource.ARCHITECT,
        detail: `Asked for ${workingDays(elapsed)} ago and nothing has come back.`,
      });
    }
  }

  return { raise, resolve };
}
