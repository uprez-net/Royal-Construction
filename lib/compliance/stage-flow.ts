import {
  CertifierEngagementStatus,
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  CertifierEmailDirection,
  CompliancePartyType,
} from "@prisma/client";

import {
  ARCHITECT_PLANS_BUSINESS_DAYS,
  ARCHITECT_REVISION_BUSINESS_DAYS,
  documentTypesForParty,
  EXTERNAL_APPLICATION_COPY,
  isNotRequired,
  PARTY_RESPONSE_BUSINESS_DAYS,
} from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  checklistBlockedReason,
  externalApplication,
  hasDevelopmentApplication,
  latestSubmission,
  meetingHeldAt,
  outreachForParty,
  outstandingRevision,
  requiresPlanningCertificate,
  type CertifierEngagementDetail,
  type ComplianceAlertRecord,
} from "@/types/compliance";

/**
 * The compliance file as a sequence of stages, with the clock on each.
 *
 * The tab has always known which block the flow is waiting on -- `activeSection`
 * has decided that since the party sections landed -- but it only ever used it
 * to put a "Now" pill on one card. Nothing on the page said what the whole route
 * was, how long the current step had been running, or which of the quoted
 * turnarounds behind it had already been blown. That is what the header this
 * feeds renders.
 *
 * A pure function over one engagement, for the same reason `assessOverdueConditions`
 * is one: every figure here is a comparison between a stored date and a
 * threshold, so the nightly sweep, this header and the tests can all read the
 * same arithmetic. Which matters more than usual here, because the two are
 * describing the same waits from different ends -- the sweep raises the alert
 * and this says how close the next one is. A header counting calendar days
 * against a sweep counting business days would show a stage with four days left
 * on the morning an alert was raised against it.
 *
 * Nothing here reads the database and nothing writes. The stage list is derived
 * entirely from documents, outreaches, applications and alerts already loaded
 * by `certifierEngagementInclude`.
 */

export type ComplianceStageId =
  | "SURVEYOR"
  | "ARCHITECT"
  | "COUNCIL"
  | "CERTIFIER"
  | "DEVELOPMENT_APPLICATION"
  | "CHECKLIST"
  | "CERTIFICATE";

/**
 * Where a stage is up to.
 *
 * Three values rather than four: "overdue" is not one of them. A stage is
 * overdue *and* current, and collapsing the two into one enum meant the node
 * that was late stopped being the node the flow was on -- so a reader looking
 * for where the work is found nothing marked.
 */
export type ComplianceStageState = "done" | "current" | "upcoming";

export type ComplianceStage = {
  id: ComplianceStageId;
  /** The heading, matching the section card this stage corresponds to. */
  label: string;
  state: ComplianceStageState;
  /**
   * When the wait on this stage started, or null where nothing has started it.
   *
   * Null is common and is not a gap in the data: a surveyor nobody has written
   * to yet, an architect whose client meeting is not booked, a 10.7 nobody has
   * lodged. There is no clock running on any of them, and inventing one --
   * counting from the engagement's own creation, say -- would have every stage
   * of a three-month-old file reading as months overdue.
   */
  startedAt: Date | null;
  /** NSW business days since `startedAt`, or null where there is none. */
  elapsedBusinessDays: number | null;
  /**
   * The turnaround quoted for this stage, or null where nobody quotes one.
   *
   * The certifier, the checklist and the closing documents have none. That is
   * not an omission to be filled in later: a certifier assessing twenty items
   * works to no published SLA, and a countdown against a number we invented
   * would be a red badge on a firm that is not late.
   */
  slaBusinessDays: number | null;
  /**
   * Working days remaining, negative once past. Null without an SLA.
   *
   * Signed rather than clamped, because the header says both halves -- "3 days
   * left" and "3 days over" are the same figure read from either side of zero,
   * and a clamped one cannot say the second.
   */
  daysLeft: number | null;
  /**
   * Whether this stage has an open alert against it.
   *
   * Read off the alerts the sweep actually raised rather than recomputed from
   * `daysLeft`, which is the important half. The sweep is the one thing that
   * decides a party is late -- it knows about a checklist line marked not
   * required, a party the client supplied, a DA that took the certificate out
   * of the pack -- and a header doing its own arithmetic would go red on the
   * stage where the sweep had decided there was nobody outstanding.
   */
  isOverdue: boolean;
  /** The open alerts filed against this stage, for the header's tooltip. */
  alerts: ComplianceAlertRecord[];
};

/**
 * Which stage each alert belongs to.
 *
 * Exhaustive over the enum so a new alert type is a compile error here rather
 * than an alert that silently reddens nothing. What this table gives is where
 * an alert belongs in principle; `stageForAlert` below corrects it to the block
 * the reader can actually act in on this particular file.
 */
const ALERT_STAGE: Readonly<
  Record<ComplianceAlertType, ComplianceStageId>
> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]: "SURVEYOR",
  [ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE]: "SURVEYOR",
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]: "ARCHITECT",
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]: "ARCHITECT",
  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: "COUNCIL",

  // The application itself, and the three permits bought alongside it. Every
  // one of these falls back to the checklist on a file with no DA -- see
  // `stageForAlert`, since a CDC lodges a levy and a road opening permit too.
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: "DEVELOPMENT_APPLICATION",
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]: "DEVELOPMENT_APPLICATION",
  [ComplianceAlertType.ROAD_OPENING_DELAYED]: "DEVELOPMENT_APPLICATION",
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]: "DEVELOPMENT_APPLICATION",
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]: "DEVELOPMENT_APPLICATION",

  // The developer's covenant is a condition on lodging the application, and the
  // consultant's redraw is what a refusal costs. Both sit in the DA block where
  // there is one; the sweep raises them off outreach rows alone, so both can be
  // open on a file that has none.
  [ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE]: "DEVELOPMENT_APPLICATION",
  [ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE]: "DEVELOPMENT_APPLICATION",

  // Moved to the DA while the checklist is frozen -- see `stageForAlert`.
  [ComplianceAlertType.BASIX_RESPONSE_OVERDUE]: "CHECKLIST",
  [ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE]: "CHECKLIST",
  [ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE]: "CHECKLIST",
  [ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE]: "CHECKLIST",
  [ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE]: "CHECKLIST",
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]: "CHECKLIST",
};

/**
 * Which stage one alert reddens on this particular file.
 *
 * `ALERT_STAGE` says which block an alert belongs to in principle. This says
 * which block the reader can actually act in, which is not always the same one,
 * and the difference runs in both directions between the two blocks that share
 * a slot on the tab:
 *
 * - **A DA stage that is not there.** The three bought permits, the developer's
 *   covenant and the redraw a refusal costs all have their rows on the DA list,
 *   so the table files them under the development application. But a CDC lodges
 *   a long service levy and a road opening permit too, and the sweep raises
 *   those from the application rows alone — on a file with no DA the stage they
 *   name is not in the flow, and the alert reddened nothing anywhere.
 * - **A checklist nobody can work on.** The consultants are engaged from the
 *   certifier's checklist on a CDC and from the DA list on a job waiting for
 *   development approval, where the checklist is frozen. The alert is identical
 *   either way, so only the file can say which block to point at.
 *
 * Written as two corrections to the table rather than as a list of exceptions,
 * which is what makes it total: the flow always has a CHECKLIST node and only
 * sometimes has a DEVELOPMENT_APPLICATION one, so anything routed to the second
 * on a file without it falls back to the first. There is no alert type that can
 * name a stage the flow did not build, and a test walks the whole enum to
 * prove it.
 */
export function stageForAlert(
  engagement: CertifierEngagementDetail,
  type: ComplianceAlertType,
): ComplianceStageId {
  const belongsTo = ALERT_STAGE[type];
  const hasDa = hasDevelopmentApplication(engagement);

  if (belongsTo === "DEVELOPMENT_APPLICATION") {
    return hasDa ? "DEVELOPMENT_APPLICATION" : "CHECKLIST";
  }

  if (belongsTo === "CHECKLIST" && checklistBlockedReason(engagement) && hasDa) {
    return "DEVELOPMENT_APPLICATION";
  }

  return belongsTo;
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

/** The wait, worked out once for every stage that has dates behind it. */
function clock(
  startedAt: Date | null,
  slaBusinessDays: number | null,
  now: Date,
): Pick<
  ComplianceStage,
  "startedAt" | "elapsedBusinessDays" | "slaBusinessDays" | "daysLeft"
> {
  if (!startedAt) {
    return {
      startedAt: null,
      elapsedBusinessDays: null,
      slaBusinessDays,
      daysLeft: null,
    };
  }

  const elapsed = businessDaysSince(startedAt, now);
  return {
    startedAt,
    elapsedBusinessDays: elapsed,
    slaBusinessDays,
    daysLeft: slaBusinessDays === null ? null : slaBusinessDays - elapsed,
  };
}

/**
 * The surveyor: engaged, and then either they send the three documents or the
 * client turns out to have had them all along.
 */
function surveyorStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const outreach = outreachForParty(engagement, CompliancePartyType.SURVEYOR);
  const inPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );
  const done = documentTypesForParty(CompliancePartyType.SURVEYOR)
    .filter((type) => inPlay.has(type))
    .every((type) => isSettled(engagement, type));

  // Nothing is running on a party the client supplied. The stage is finished
  // with the moment that is recorded, so it carries no clock at all rather than
  // one that started when the row was written.
  const running =
    outreach && outreach.mode === ComplianceOutreachMode.OUTREACH
      ? outreach.sentAt
      : null;

  return {
    id: "SURVEYOR",
    label: "Surveyor",
    done,
    ...clock(
      running,
      PARTY_RESPONSE_BUSINESS_DAYS[CompliancePartyType.SURVEYOR],
      now,
    ),
  };
}

/**
 * The architect, whose clock is whichever of three is actually running.
 *
 * Read in the same order the sweep reads them, and for the same reason: an
 * outstanding revision is the live wait even on a file where the plans arrived
 * months ago, and an architect who has not sat with the owners has nothing to
 * draw yet, so counting from the outreach would chase them for work they cannot
 * have started. Where neither clock is running the stage shows how long the
 * architect has been engaged and counts down nothing.
 */
function architectStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const outreach = outreachForParty(engagement, CompliancePartyType.ARCHITECT);
  const plansIn = isSettled(
    engagement,
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  );
  const revision = outstandingRevision(outreach);
  const heldAt = meetingHeldAt(outreach);

  const done =
    outreach?.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
    (plansIn && !revision);

  const [startedAt, sla] = revision
    ? [revision.requestedAt, ARCHITECT_REVISION_BUSINESS_DAYS]
    : !plansIn && heldAt
      ? [heldAt, ARCHITECT_PLANS_BUSINESS_DAYS]
      : [
          outreach?.mode === ComplianceOutreachMode.OUTREACH
            ? outreach.sentAt
            : null,
          null,
        ];

  return {
    id: "ARCHITECT",
    label: "Architect",
    done,
    ...clock(startedAt, sla, now),
  };
}

/**
 * The 10.7 certificate, bought from a portal.
 *
 * The clock starts at the lodgement rather than at the question being answered:
 * a builder who already holds a current certificate has no wait at all, and one
 * who has not lodged yet is not waiting on the council.
 */
function councilStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const application = externalApplication(
    engagement,
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
  );
  const certificateIn = isSettled(
    engagement,
    ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
  );

  // A DA takes the certificate out of the pack. The stage is finished with as
  // far as this header is concerned -- the certificate is still wanted, but it
  // is ordered from the DA block and chased on the DA's own stage.
  const done =
    certificateIn ||
    Boolean(application?.receivedAt) ||
    !requiresPlanningCertificate(engagement);

  return {
    id: "COUNCIL",
    label: "Planning certificate",
    done,
    ...clock(
      latestSubmission(application)?.submittedAt ?? null,
      EXTERNAL_APPLICATION_COPY[
        ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7
      ].businessDays,
      now,
    ),
  };
}

/**
 * The pack going to the certifier, and their reply coming back.
 *
 * No SLA, and deliberately none. A certifier reading a pack, quoting a fee and
 * issuing a checklist works to no published turnaround, and a threshold we
 * invented would put a red badge on a firm that is not late. The stage says how
 * long it has been and leaves the judgement to the reader.
 *
 * The start is the first outbound mail rather than the engagement's own
 * `createdAt`, which is when somebody typed a certifier's address in -- often
 * weeks before the pack is whole enough to send.
 */
function certifierStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const firstSend = engagement.emails.find(
    (email) => email.direction === CertifierEmailDirection.OUTBOUND,
  );

  return {
    id: "CERTIFIER",
    label: "Certifier",
    // The checklist existing is what says the certifier has answered. Reading
    // the status rather than the documents keeps this and the tab's own
    // "collection is over" line the same reading.
    done: engagement.documents.some(
      (document) =>
        document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
    ),
    ...clock(firstSend?.sentAt ?? null, null, now),
  };
}

/**
 * The development application, present only on the files that have one.
 *
 * Sixty working days, which is the top of what a NSW residential application
 * takes rather than a target of ours -- see `DA_DETERMINATION_BUSINESS_DAYS`.
 * The clock is the latest round rather than the first lodgement, because a DA
 * resubmitted in April is not sixty days late for having first gone in in
 * March.
 */
function developmentApplicationStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const application = externalApplication(
    engagement,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  );
  const submission = latestSubmission(application);

  return {
    id: "DEVELOPMENT_APPLICATION",
    label: "Development application",
    // Determined. The certificate leaving the pack is what a raised DA does;
    // the certificate coming back to the pack is what consent granted does, and
    // that is the same predicate read the other way.
    done: Boolean(application?.receivedAt),
    ...clock(
      submission?.submittedAt ?? null,
      submission
        ? EXTERNAL_APPLICATION_COPY[
            ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION
          ].businessDays
        : // Nothing lodged means no clock to count against. The application is
          // still being assembled, and a countdown here would be against a
          // council that has not been given anything yet.
          null,
      now,
    ),
  };
}

/** Every checklist line answered, one way or the other. */
function checklistStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const items = engagement.documents.filter(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  // When the certifier issued it. The earliest row rather than the latest: a
  // re-extraction rewrites the rows, and reading the newest would restart the
  // clock on a list that has been open for a month.
  const issuedAt = items.reduce<Date | null>(
    (earliest, item) =>
      !earliest || item.createdAt < earliest ? item.createdAt : earliest,
    null,
  );

  return {
    id: "CHECKLIST",
    label: "Checklist",
    done:
      items.length > 0 &&
      items.every(
        (item) => item.files.length > 0 || isNotRequired(item.status),
      ),
    ...clock(issuedAt, null, now),
  };
}

/**
 * The construction certificate and the HBCF cover.
 *
 * The one stage with no start date of its own. Nothing timestamps the certifier
 * passing the last checklist item, and the gap between that and the certificate
 * being issued is entirely theirs -- so the stage says it is where the file is
 * up to and says nothing about how long, rather than counting from a date that
 * would be a guess.
 */
function certificateStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): Omit<ComplianceStage, "state" | "isOverdue" | "alerts"> & { done: boolean } {
  const certificate = engagement.documents.find(
    (document) =>
      document.documentType ===
      ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
  );

  return {
    id: "CERTIFICATE",
    label: "Certificate and cover",
    done: engagement.status === CertifierEngagementStatus.COMPLETED,
    ...clock(certificate?.createdAt ?? null, null, now),
  };
}

/**
 * The whole route this file takes, in order, with the clock on each stage.
 *
 * Exactly one stage is `current`: the first that is not done. Everything before
 * it is `done` and everything after is `upcoming`, which is what lets the header
 * be read at a glance rather than decoded. A finished file has no current stage,
 * and that is the honest answer -- there is nothing left to be waiting on.
 */
export function complianceStageFlow(
  engagement: CertifierEngagementDetail,
  now: Date = new Date(),
): ComplianceStage[] {
  const open = engagement.alerts.filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );

  const built = [
    surveyorStage(engagement, now),
    architectStage(engagement, now),
    councilStage(engagement, now),
    certifierStage(engagement, now),
    // Only on the files that have one. A CDC that never needed development
    // approval should not carry a permanently grey node for a step it is not
    // taking -- the header is what the route is, not what every route could be.
    ...(hasDevelopmentApplication(engagement)
      ? [developmentApplicationStage(engagement, now)]
      : []),
    checklistStage(engagement, now),
    certificateStage(engagement, now),
  ];

  const currentIndex = built.findIndex((stage) => !stage.done);

  return built.map(({ done, ...stage }, index) => {
    const alerts = open.filter(
      (alert) => stageForAlert(engagement, alert.type) === stage.id,
    );

    return {
      ...stage,
      state: done
        ? "done"
        : index === currentIndex
          ? "current"
          : ("upcoming" as const),
      // A done stage with an open alert still reads as late, which is not a
      // contradiction: a stale title search is raised against a surveyor who
      // has sent everything they were asked for.
      isOverdue: alerts.length > 0,
      alerts,
    } satisfies ComplianceStage;
  });
}
