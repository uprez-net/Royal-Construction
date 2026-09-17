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
import { PORTAL_DOWNLOAD_ALERT } from "@/lib/compliance/portal-certificates";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  developerApprovalFor,
  externalApplication,
  latestSubmission,
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
): {
  raise?: OverdueAlert;
  resolve?: { type: ComplianceAlertType; note: string };
} {
  const outreach = outreachForParty(engagement, party);

  // Nobody was written to, or the client supplied the documents themselves.
  // Neither is a party running late; there is nobody waiting on anybody.
  if (
    !outreach ||
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
    !outreach.sentAt
  ) {
    return {
      resolve: {
        type: alertType,
        note: "There is nobody outstanding on this.",
      },
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
  [CompliancePartyType.BASIX_CONSULTANT]:
    ComplianceAlertSource.BASIX_CONSULTANT,
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
 * Whether one party has answered everything the engagement asked them for.
 *
 * Read off the deliverables table, which is the whole reason that table exists:
 * a structural engineer answers three lines off one engagement, and the single
 * `checklistDocumentId` column it replaced could only ever name one of them. A
 * job holding the structural drawings and three weeks overdue on the
 * geotechnical report read, through that column, as finished with them.
 *
 * A deliverable is settled two ways, because it is asked for two ways:
 *
 * - **Against a checklist line.** The row is the thing being waited on, and its
 *   own file or its NOT_REQUIRED status answers it. A line that has since gone
 *   -- a checklist re-extracted since the outreach -- is treated as settled
 *   rather than outstanding: there is nothing on screen to chase against, so an
 *   alert raised on it would point nowhere.
 * - **By type alone.** `startPartyOutreach` writes a null `checklistDocumentId`
 *   for every deliverable raised off the development application, where there
 *   is no certifier checklist to hang one on. Those are settled when a document
 *   of that type is on the file.
 *
 * The second half is the correction. Reading only the checklist rows meant a
 * DA-raised engagement resolved to an empty target list, `[].every()` returned
 * true, and the sweep closed the alert with "Their documents came through" over
 * a consultant who had sent nothing at all -- the one failure mode on this file
 * that is completely silent, because the alert it closes is the only thing that
 * would have said otherwise.
 *
 * An outreach carrying no deliverables and no legacy column is genuinely
 * finished with; there is nothing recorded that anybody is waiting for.
 */
function isOutreachSettled(
  engagement: CertifierEngagementDetail,
  outreach: ComplianceOutreachDetail | undefined,
): boolean {
  if (!outreach) return true;

  const rowsById = new Map(
    engagement.documents.map((document) => [document.id, document]),
  );
  const isRowSettled = (document: ComplianceDocumentWithFiles) =>
    document.files.length > 0 || isNotRequired(document.status);

  const deliverables = outreach.deliverables;

  if (deliverables.length === 0) {
    // The consultants engaged before the table existed, whose one line is on
    // the outreach itself.
    if (!outreach.checklistDocumentId) return true;
    const row = rowsById.get(outreach.checklistDocumentId);
    return !row || isRowSettled(row);
  }

  return deliverables.every((deliverable) => {
    if (deliverable.checklistDocumentId) {
      const row = rowsById.get(deliverable.checklistDocumentId);
      return !row || isRowSettled(row);
    }
    return isSettled(engagement, deliverable.documentType);
  });
}

export function assessOverdueConditions(
  engagement: CertifierEngagementDetail,
  now: Date = new Date(),
): OverdueAssessment {
  const raise: OverdueAlert[] = [];
  const resolve: { type: ComplianceAlertType; note: string }[] = [];

  const record = (outcome: ReturnType<typeof assessPartyResponse>) => {
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

    /**
     * The download the portal's approval email leaves behind.
     *
     * Raised and resolved here rather than only on the arrival of the mail,
     * because closing is the half that gets forgotten and this one closes on an
     * event the mail handler cannot see: somebody uploading the certificate.
     * The full nightly recompute is exactly what that asymmetry is for.
     *
     * Three kinds can be in this state -- both certificates and the development
     * application -- and `PORTAL_DOWNLOAD_ALERT` is partial over the seven, so a
     * kind with no entry simply never reaches the raise.
     */
    const downloadAlert = PORTAL_DOWNLOAD_ALERT[kind];
    if (downloadAlert) {
      if (application?.approvalNotifiedAt && !documentIn) {
        raise.push({
          type: downloadAlert,
          source: ComplianceAlertSource.COUNCIL,
          detail: `Determined ${workingDays(
            businessDaysSince(application.approvalNotifiedAt, now),
          )} ago${
            application.applicationRef
              ? ` under ${application.applicationRef}`
              : ""
          }. The ${copy.label.toLowerCase()} is on the portal and not on the file.`,
        });
      } else if (documentIn) {
        resolve.push({
          type: downloadAlert,
          note: `${copy.label} has been downloaded and is on the file.`,
        });
      }
    }

    /**
     * What stops the determination clock.
     *
     * `approvalNotifiedAt` is the addition, and it is the whole reason that
     * column exists. The portal answering is what ends the wait on *them*; the
     * document arriving is a separate wait on us, and chasing a certifier who has
     * already determined the application is the complaint this prevents. The
     * download-ready alert above is what carries the remaining step, so nothing
     * is lost by closing this one.
     */
    if (
      !wanted ||
      documentIn ||
      application?.receivedAt ||
      application?.approvalNotifiedAt
    ) {
      resolve.push({
        type: copy.alertType,
        note: documentIn
          ? `${copy.label} is on the file.`
          : (application?.receivedAt ?? application?.approvalNotifiedAt)
            ? `${copy.label} came back.`
            : `${copy.label} is not part of this job.`,
      });
      continue;
    }

    // The latest round rather than the first lodgement. A DA resubmitted in
    // April is not sixty working days late for having first gone in in March,
    // and measuring from `appliedAt` had every application that was ever sent
    // back permanently overdue from the moment it went back in.
    const submission = latestSubmission(application);

    if (!submission) {
      // Nothing lodged means no clock. Not resolved either: an alert raised on
      // a previous run stays open, because the clock only moves forward and an
      // admin clearing a lodgement date is not the wait ending.
      continue;
    }

    const elapsed = businessDaysSince(submission.submittedAt, now);
    if (elapsed > copy.businessDays) {
      raise.push({
        type: copy.alertType,
        source: ComplianceAlertSource.COUNCIL,
        detail: `${
          submission.round > 1
            ? `Resubmitted (round ${submission.round})`
            : "Lodged"
        } ${workingDays(elapsed)} ago${
          submission.applicationRef ? ` under ${submission.applicationRef}` : ""
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

    // Everything this party was asked for, however it was asked. See
    // `isOutreachSettled` -- a deliverable raised off the development
    // application carries a type and no checklist line, and judging those by
    // the checklist alone closed the alert over a consultant who had sent
    // nothing.
    const isComplete = isOutreachSettled(engagement, outreach);

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
  // Two documents under covenant and three clocks. The developer is waiting on
  // twice over -- once for the bushfire report and once for the full
  // architectural design -- and a refusal of the report opens a third wait on the
  // consultant who has to redo it.
  //
  // One alert type per wait, because at most one alert of a type is open per file
  // and all three can be live at once: a developer sitting on the plans while the
  // report they rejected last month is still being redone is an ordinary state of
  // a job, not an edge case. Folding the two documents into
  // DEVELOPER_RESPONSE_OVERDUE meant a file could only ever say one of them out
  // loud, and the chase went out naming the wrong document.
  //
  // Each clock runs from the request for *that* document rather than from the
  // outreach, which is the correction the per-document rows made possible. The
  // plans go over when the architect finishes them and the report weeks or months
  // later off a checklist line, so one clock off `outreach.sentAt` had the second
  // document overdue on the day it was sent.
  // -------------------------------------------------------------------
  const developer = outreachForParty(engagement, CompliancePartyType.DEVELOPER);

  const developerWaits = [
    {
      documentType: ComplianceDocumentType.BUSHFIRE_REPORT,
      type: ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
      label: "The bushfire report",
    },
    {
      documentType: ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
      type: ComplianceAlertType.DEVELOPER_PLANS_OVERDUE,
      label: "The architectural design",
    },
  ] as const;

  for (const wait of developerWaits) {
    const approval = developerApprovalFor(engagement, wait.documentType);

    if (!developer || !approval || approval.decision) {
      // Nobody asked, it was never put to them, or they have answered. A
      // rejection counts as answered: the wait has moved to whoever has to redo
      // the document, and chasing a developer who has already told us no is the
      // alert pointing at the wrong party.
      resolve.push({
        type: wait.type,
        note: approval?.decision
          ? "The developer has given their answer."
          : "Nobody is waiting on a developer approval.",
      });
      continue;
    }

    const elapsed = businessDaysSince(approval.requestedAt, now);
    if (elapsed > PARTY_RESPONSE_BUSINESS_DAYS[CompliancePartyType.DEVELOPER]) {
      raise.push({
        type: wait.type,
        source: ComplianceAlertSource.DEVELOPER,
        detail: `${wait.label} went to them ${workingDays(elapsed)} ago and no decision has come back.`,
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
