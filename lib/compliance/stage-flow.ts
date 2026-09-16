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
import {
  certificateApplication,
  certificateDocumentTypeFor,
  certificateKindFor,
  hasCertificate,
  isPortalDownloadAlert,
} from "@/lib/compliance/portal-certificates";
import { businessDaysSince } from "@/lib/dates/business-days";
import { applicableRequiredDocuments } from "@/lib/compliance/required-pack";
import {
  STAGE_ACTORS,
  type ComplianceStageActor,
} from "@/lib/compliance/stage-actors";
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
  | "PLANNING_PORTAL"
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

/**
 * Which line of the drawing a stage sits on.
 *
 * The flow is not a straight line and never was. Development approval leaves
 * the main run at whichever step the job was on when somebody said it was
 * needed, does a month of its own work with its own cast, and comes back in at
 * the checklist — and rendering that as a seventh node in a row said none of
 * it. It read as a step every job takes, which is the opposite of true.
 */
export type ComplianceStageTrack = "main" | "approval";

export type ComplianceStage = {
  id: ComplianceStageId;
  /** The heading, matching the section card this stage corresponds to. */
  label: string;
  state: ComplianceStageState;
  track: ComplianceStageTrack;
  /**
   * Whether this stage is on the route this file actually takes.
   *
   * True for every stage on the main run, always. False only for a dormant
   * development approval — the branch is drawn on every job so the reader can
   * see the route exists, and it lights up when the alert that puts a job on it
   * is raised or a lodgement is recorded. See `hasDevelopmentApplication`.
   *
   * A dormant stage carries no clock, no alerts and never holds the marker: it
   * is a picture of a road this job is not on.
   */
  isActive: boolean;
  /**
   * Where the branch leaves the main line, and where it comes back.
   *
   * Both null on the main run. On the approval branch they are the two nodes
   * the connector is drawn between, which is what makes the drawing a graph
   * rather than a row — see `branchOrigin` for how the leaving point is
   * decided.
   */
  branchesFrom: ComplianceStageId | null;
  rejoinsAt: ComplianceStageId | null;
  /** Who is behind this stage, and whether they still owe it anything. */
  actors: ComplianceStageActor[];
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
  /**
   * When the wait on this stage ended, or null while it is still running.
   *
   * The half that was missing, and the whole of why a finished stage kept a
   * clock on it. `elapsedBusinessDays` was measured to *now* on every stage
   * regardless of state, so a surveyor engaged a fortnight ago and finished on
   * the Tuesday read "3 days over" against their own quote for the rest of the
   * file's life — a green tick with a red-shaped number under it, on a firm
   * that delivered on time.
   *
   * Null on a finished stage is not a gap either. Only some of these have a
   * date behind the finish: a 10.7 is received, a checklist is issued, and
   * nothing whatsoever timestamps a certifier passing the last item. Where
   * there is no such date the stage says how it ended and nothing about when,
   * which is the honest answer — see `clock`.
   */
  settledAt: Date | null;
  /**
   * NSW business days the wait took, or has taken so far.
   *
   * Counted to `settledAt` once there is one and to `now` before that, so a
   * finished stage reports how long it took rather than how long ago it
   * started.
   */
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
   *
   * Null once the stage is settled, whatever the arithmetic would have said. A
   * wait that is over has no time left in it in either direction, and the
   * countdown outliving the wait is what put "9d over" under a finished node.
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
  /**
   * Whether this stage is waiting on a download rather than on anybody.
   *
   * The positive counterpart of `isOverdue`, and its own field rather than a
   * third value on one enum because the two are genuinely independent: a portal
   * stage can hold a determination waiting to be fetched *and* a second
   * application that is past its days. Collapsing them would mean choosing which
   * of those a reader is told about.
   *
   * Read off the same alerts `isOverdue` is, so the node and the panel above the
   * tabs cannot disagree about what is outstanding on a stage.
   */
  hasPortalDownload: boolean;
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

  // The developer sitting on the architectural design. Filed with the other two
  // developer alerts and corrected by `stageForAlert` on a file with no DA, for
  // the same reason they are: the covenant binds a CDC exactly as hard, and it
  // is the portal lodgement it blocks there.
  [ComplianceAlertType.DEVELOPER_PLANS_OVERDUE]: "DEVELOPMENT_APPLICATION",

  // -------------------------------------------------------------------
  // The portal stage.
  //
  // The two certificate determinations and the download that follows either of
  // them all belong to the lodgement rather than to the certificate: the
  // certificate node is where the document lands, and these are raised while
  // there is no document and nothing for that node to be about.
  // -------------------------------------------------------------------
  [ComplianceAlertType.CDC_DETERMINATION_OVERDUE]: "PLANNING_PORTAL",
  [ComplianceAlertType.CC_DETERMINATION_OVERDUE]: "PLANNING_PORTAL",
  [ComplianceAlertType.CDC_DOWNLOAD_READY]: "PLANNING_PORTAL",
  [ComplianceAlertType.CC_DOWNLOAD_READY]: "PLANNING_PORTAL",

  // The consent, which is the DA's own determination arriving the same way.
  // Corrected to the checklist on a file with no DA node, like everything else
  // routed here -- though in practice this one cannot be raised on such a file,
  // since nothing lodges a development application on a job that has none.
  [ComplianceAlertType.DA_DOWNLOAD_READY]: "DEVELOPMENT_APPLICATION",

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

/**
 * What one stage builder produces.
 *
 * The identity of the stage and the clock on it, and deliberately nothing about
 * where it sits: the track it is drawn on, whether the file is on it, who is
 * behind it and whether it holds the marker are all decisions about the flow as
 * a whole rather than about one stage, and `complianceStageFlow` is the one
 * place that can make them. `done` is the builder's own verdict and is folded
 * into `state` there.
 */
type BuiltStage = Pick<
  ComplianceStage,
  | "id"
  | "label"
  | "startedAt"
  | "settledAt"
  | "elapsedBusinessDays"
  | "slaBusinessDays"
  | "daysLeft"
> & { done: boolean };

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
 * Whether a stage's wait is over, and when.
 *
 * Two facts rather than one, because they come apart: every finished stage
 * knows *that* it is finished and only some of them know *when*. A 10.7 is
 * received on a date, a checklist is issued on a date, and nothing whatsoever
 * timestamps a certifier passing the last item on a twenty-line list. So
 * `null` here means the wait is still running, and `{ at: null }` means it is
 * over and the file does not record the instant — which is a different thing
 * from both and has to be, or a finished stage falls back to counting to now.
 */
type StageSettlement = { at: Date | null } | null;

/**
 * The wait, worked out once for every stage that has dates behind it.
 *
 * The settlement is what stops the clock, and stopping it is the whole of this
 * change. Elapsed was measured to *now* on every stage regardless of state, so
 * a surveyor engaged a fortnight ago and finished on the Tuesday read "3 days
 * over" against their own quote for the rest of the file's life — a green tick
 * with a red-shaped number under it, on a firm that delivered on time.
 *
 * A settled stage never counts down, whatever the arithmetic would have said: a
 * wait that is over has no days left in it in either direction. Where the
 * instant is known it reports how long the wait took; where it is not, it
 * reports nothing rather than a figure measured to the wrong end.
 */
function clock(
  startedAt: Date | null,
  settled: StageSettlement,
  slaBusinessDays: number | null,
  now: Date,
): Pick<
  ComplianceStage,
  | "startedAt"
  | "settledAt"
  | "elapsedBusinessDays"
  | "slaBusinessDays"
  | "daysLeft"
> {
  const settledAt = settled?.at ?? null;

  if (!startedAt) {
    return {
      startedAt: null,
      settledAt,
      elapsedBusinessDays: null,
      slaBusinessDays,
      daysLeft: null,
    };
  }

  if (settled) {
    return {
      startedAt,
      settledAt,
      elapsedBusinessDays: settledAt
        ? businessDaysSince(startedAt, settledAt)
        : null,
      slaBusinessDays,
      daysLeft: null,
    };
  }

  const elapsed = businessDaysSince(startedAt, now);
  return {
    startedAt,
    settledAt: null,
    elapsedBusinessDays: elapsed,
    slaBusinessDays,
    daysLeft: slaBusinessDays === null ? null : slaBusinessDays - elapsed,
  };
}

/**
 * The latest date on which one of these document types landed, or null.
 *
 * What a stage finished at, where the stage is finished by documents arriving.
 * The latest rather than the earliest: a surveyor owes three documents and is
 * finished with when the last of them is in, not the first.
 *
 * Read off the files rather than off the row they hang from, which is the
 * correction. A ComplianceDocument row is written when the type enters the
 * pack — the fixed types are laid down with the engagement, a checklist line
 * the moment the extraction reads it — and the file that answers it arrives
 * days or weeks later. Taking `document.createdAt` therefore measured the wait
 * to the instant the question was *asked*: a surveyor written to on the Monday
 * whose deposited plan has sat on the file since the engagement opened finished
 * before they were asked, and `businessDaysSince` clamped that to a flat "Done
 * in 0d" under a green tick. The file's own `createdAt` is when the answer
 * landed, which is the instant the stage is actually finished at.
 *
 * A row that was waved off rather than supplied has no file on it, so it is
 * skipped exactly as before and a set closed out that way returns null — the
 * stage keeps no duration, which is better than a figure measured to the wrong
 * instant.
 */
function latestArrival(
  engagement: CertifierEngagementDetail,
  documentTypes: readonly ComplianceDocumentType[],
): Date | null {
  const wanted = new Set(documentTypes);
  let latest: Date | null = null;

  for (const document of engagement.documents) {
    if (!wanted.has(document.documentType)) continue;
    // A row with no files contributes nothing, which is the non-empty-file
    // filter this used to spell out separately: an empty loop cannot move
    // `latest`.
    for (const file of document.files) {
      if (!latest || file.createdAt > latest) latest = file.createdAt;
    }
  }

  return latest;
}

/**
 * The surveyor: engaged, and then either they send the three documents or the
 * client turns out to have had them all along.
 */
function surveyorStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): BuiltStage {
  const outreach = outreachForParty(engagement, CompliancePartyType.SURVEYOR);
  const inPlay = new Set(
    applicableRequiredDocuments(engagement).map((required) => required.type),
  );
  const wanted = documentTypesForParty(CompliancePartyType.SURVEYOR).filter(
    (type) => inPlay.has(type),
  );
  const done = wanted.every((type) => isSettled(engagement, type));

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
      done ? { at: latestArrival(engagement, wanted) } : null,
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
): BuiltStage {
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
    ...clock(
      startedAt,
      // The plans landing is what ends the wait, whichever of the three clocks
      // was running: a revision is finished with by a revised set arriving on
      // the same row.
      done
        ? {
            at: latestArrival(engagement, [
              ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
            ]),
          }
        : null,
      sla,
      now,
    ),
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
): BuiltStage {
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
      // The portal answering, however that was recorded. A DA having taken the
      // certificate out of the pack is not the portal answering, so that case
      // finishes the stage with no duration on it rather than with one measured
      // to a date nobody waited until.
      done
        ? {
            at:
              application?.receivedAt ??
              latestArrival(engagement, [
                ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
              ]),
          }
        : null,
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
): BuiltStage {
  const firstSend = engagement.emails.find(
    (email) => email.direction === CertifierEmailDirection.OUTBOUND,
  );
  const issuedAt = checklistIssuedAt(engagement);

  return {
    id: "CERTIFIER",
    label: "Certifier",
    // The checklist existing is what says the certifier has answered. Reading
    // the status rather than the documents keeps this and the tab's own
    // "collection is over" line the same reading.
    done: issuedAt !== null,
    // The same instant the checklist stage starts from, which is the point: the
    // certifier's wait ends where the checklist's begins, and two readings of
    // one handover would leave a day unaccounted for between two nodes.
    ...clock(firstSend?.sentAt ?? null, issuedAt ? { at: issuedAt } : null, null, now),
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
): BuiltStage {
  const application = externalApplication(
    engagement,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  );
  const submission = latestSubmission(application);

  return {
    id: "DEVELOPMENT_APPLICATION",
    label: "Development approval",
    // Determined. The certificate leaving the pack is what a raised DA does;
    // the certificate coming back to the pack is what consent granted does, and
    // that is the same predicate read the other way.
    done: Boolean(application?.receivedAt),
    ...clock(
      submission?.submittedAt ?? null,
      application?.receivedAt ? { at: application.receivedAt } : null,
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

/**
 * When the certifier issued the checklist, or null before they have.
 *
 * The earliest row rather than the latest: a re-extraction rewrites the rows,
 * and reading the newest would restart the clock on a list that has been open
 * for a month.
 *
 * Read by both stages either side of the handover — it is what ends the
 * certifier's wait and what starts the checklist's — so the two cannot disagree
 * about when the list arrived.
 */
function checklistIssuedAt(engagement: CertifierEngagementDetail): Date | null {
  return engagement.documents.reduce<Date | null>(
    (earliest, document) =>
      document.documentType !== ComplianceDocumentType.CHECKLIST_ITEM ||
      (earliest !== null && document.createdAt >= earliest)
        ? earliest
        : document.createdAt,
    null,
  );
}

/** Every checklist line answered, one way or the other. */
function checklistStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): BuiltStage {
  const items = engagement.documents.filter(
    (document) =>
      document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
  );

  const done =
    items.length > 0 &&
    items.every((item) => item.files.length > 0 || isNotRequired(item.status));

  return {
    id: "CHECKLIST",
    label: "Checklist",
    done,
    // Finished, and with no date to say when. Nothing timestamps the last line
    // being answered — a row waved off as not required records who decided it
    // and not when — so a completed checklist reports that it is done and says
    // nothing about how long it took, rather than counting to an instant that
    // is not the one anybody waited until.
    ...clock(checklistIssuedAt(engagement), done ? { at: null } : null, null, now),
  };
}

/**
 * The portal: the application, the appointment, and the determination.
 *
 * The stage the flow did not have, and the whole of the drift this header was
 * wrong about. It used to run Checklist -> Certificate and cover, on the reading
 * that a certifier passes the last item and issues the certificate off their own
 * desk. What actually sits between those two is a lodgement on the NSW Planning
 * Portal, a principal certifier appointment that has to go in with it on the
 * CDC path, and a determination that takes a fortnight or more -- a wait longer
 * than most of the ones the header already drew, and it was drawn nowhere.
 *
 * Labelled for the path the file is on rather than generically, because the
 * reader of this node wants to know which certificate is coming: "CDC
 * application" and "Construction certificate" are the two things it can say,
 * and "Planning portal" would make them guess.
 *
 * The clock starts at the latest submission rather than at `appliedAt`, the same
 * correction the DA node already carries: an application sent back for further
 * information and relodged is not overdue from the first lodgement. The SLA
 * exists here, unlike on the checklist and the certificate either side of it,
 * because a determination period is a real published figure rather than one we
 * invented -- see CDC_DETERMINATION_BUSINESS_DAYS.
 *
 * Finished by the determination, not by the document. That is the distinction
 * the whole change turns on: the portal answering is what ends *this* wait, and
 * fetching the certificate is the next stage's work. Reading the document here
 * would leave the node counting days against the certifier for a week in which
 * they had already done everything asked of them.
 */
function planningPortalStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): BuiltStage {
  const kind = certificateKindFor(engagement);
  const application = certificateApplication(engagement);
  const submission = latestSubmission(application);

  // Either mark of the portal having answered. `approvalNotifiedAt` is the
  // ordinary one -- the determination email -- and `receivedAt` is an admin who
  // ticked it through without one, which happens when somebody sees the
  // determination on the portal before the mail lands. The certificate being on
  // the file closes it too, for the file that skipped both: a certifier who
  // hands the certificate over at a site meeting has self-evidently determined
  // it.
  const determinedAt =
    application?.approvalNotifiedAt ??
    application?.receivedAt ??
    (hasCertificate(engagement)
      ? latestArrival(engagement, [certificateDocumentTypeFor(engagement)])
      : null);

  return {
    id: "PLANNING_PORTAL",
    label:
      kind === ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE
        ? "CDC application"
        : "Construction certificate",
    done: determinedAt !== null,
    ...clock(
      submission?.submittedAt ?? null,
      determinedAt ? { at: determinedAt } : null,
      submission
        ? EXTERNAL_APPLICATION_COPY[kind].businessDays
        : // Nothing lodged, so no clock. The pack is still being assembled or
          // the certifier has not passed it yet, and a countdown here would be
          // against a portal nobody has given anything to.
          null,
      now,
    ),
  };
}

/**
 * The certificate on the file, and the HBCF cover beside it.
 *
 * Still the last stage, and no longer the one that waits for the certifier. The
 * wait it used to describe has moved to `planningPortalStage`, which is where
 * the determination actually happens; what is left here is the two documents,
 * and both of them are ours to put on the file.
 *
 * Which is why this is the one stage with a start date that means something now.
 * It used to have none -- nothing timestamped a certifier passing the last item
 * -- and it starts at the determination, because that is the instant the
 * certificate becomes available and the clock on fetching it begins. A file that
 * is approved and still holding nothing is the state this node exists to show,
 * and it was invisible before.
 *
 * No SLA, and deliberately none: this is a wait on us rather than on anybody
 * else, and the download-ready alert is the thing that chases it.
 */
function certificateStage(
  engagement: CertifierEngagementDetail,
  now: Date,
): BuiltStage {
  const application = certificateApplication(engagement);
  const done = engagement.status === CertifierEngagementStatus.COMPLETED;

  return {
    id: "CERTIFICATE",
    label: "Certificate and cover",
    done,
    ...clock(
      application?.approvalNotifiedAt ?? application?.receivedAt ?? null,
      // Finished with, and with nothing to say when. The engagement's status is
      // the only mark that the file is closed and it carries no instant of its
      // own here.
      done ? { at: null } : null,
      null,
      now,
    ),
  };
}

/**
 * Where the approval branch leaves the main line on this particular file.
 *
 * Development approval is not a step at a fixed point in the route. It starts
 * wherever somebody first says the job needs it, and that is one of three
 * places: an architect looking at the proposal and saying it cannot go through
 * as a CDC, a certifier saying the same in their first reply, or a certifier
 * saying it on the checklist they have just issued. Drawing the branch from a
 * fixed node would be a picture of a route no particular job took.
 *
 * So it is read back off the raise: the last main stage that had actually
 * started by the time the condition was recorded. The earliest
 * DA_APPROVAL_REQUIRED rather than the open one, because the branch has to stay
 * drawn in the same place after the consent lands and the alert is closed —
 * a line that jumps to a different origin the day the job finishes is a line
 * nobody trusts.
 *
 * A job with a lodgement and no alert is the other way in, and the lodgement
 * date stands in for the raise. A dormant branch has neither and falls back to
 * the architect, which is the earliest of the three points and therefore the
 * widest span — a picture of everywhere the branch could leave from, on a job
 * that has not taken it.
 */
function branchOrigin(
  engagement: CertifierEngagementDetail,
  main: readonly { id: ComplianceStageId; startedAt: Date | null }[],
): ComplianceStageId {
  const candidates: ComplianceStageId[] = [
    "ARCHITECT",
    "CERTIFIER",
    "CHECKLIST",
  ];

  const raisedAt = engagement.alerts.reduce<Date | null>(
    (earliest, alert) =>
      alert.type !== ComplianceAlertType.DA_APPROVAL_REQUIRED ||
      (earliest !== null && alert.createdAt >= earliest)
        ? earliest
        : alert.createdAt,
    null,
  );

  const lodgedAt =
    latestSubmission(
      externalApplication(
        engagement,
        ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
      ),
    )?.submittedAt ?? null;

  const decidedAt = raisedAt ?? lodgedAt;
  if (!decidedAt) return "ARCHITECT";

  const started = new Map(main.map((stage) => [stage.id, stage.startedAt]));
  const reached = candidates.filter((id) => {
    const startedAt = started.get(id) ?? null;
    return startedAt !== null && startedAt <= decidedAt;
  });

  return reached.at(-1) ?? "ARCHITECT";
}

/**
 * The whole route this file takes, with the clock and the cast on each stage.
 *
 * Exactly one stage is `current`: the first on the main run that is not done.
 * Everything before it is `done` and everything after is `upcoming`, which is
 * what lets the header be read at a glance rather than decoded. A finished file
 * has no current stage, and that is the honest answer — there is nothing left
 * to be waiting on.
 *
 * The development approval is in the list on every job now, and it was not
 * before. That is the change: it used to be dropped from files that had not
 * taken it, on the reading that the header should be what the route is rather
 * than what every route could be. Which was right about the main run and wrong
 * about this — approval is not the seventh step of the same line, it is a
 * detour off it, and a reader who has never seen one has no way to learn that
 * the detour exists or where it goes. So it is always drawn and only sometimes
 * live: `isActive` is false until the alert is raised or a lodgement recorded,
 * and a dormant branch holds no marker, no clock and no alerts.
 *
 * Returned as one array with the branch stage in route order, so a caller that
 * wants the plain sequence still reads it top to bottom. The drawing splits it
 * on `track`.
 */
export function complianceStageFlow(
  engagement: CertifierEngagementDetail,
  now: Date = new Date(),
): ComplianceStage[] {
  const open = engagement.alerts.filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );
  const isActive = hasDevelopmentApplication(engagement);

  const main = [
    surveyorStage(engagement, now),
    councilStage(engagement, now),
    architectStage(engagement, now),
    certifierStage(engagement, now),
    checklistStage(engagement, now),
    planningPortalStage(engagement, now),
    certificateStage(engagement, now),
  ];

  // Over the main run alone. The marker says which step of the job the reader
  // should be looking at, and a dormant branch is not a step of this job —
  // letting it into the search would hand the marker to development approval on
  // every CDC ever opened.
  const currentIndex = main.findIndex((stage) => !stage.done);

  const decorate = (
    { done, ...stage }: (typeof main)[number],
    extras: Pick<
      ComplianceStage,
      "track" | "isActive" | "branchesFrom" | "rejoinsAt"
    > & { state?: ComplianceStageState },
    index: number,
  ): ComplianceStage => {
    const alerts = extras.isActive
      ? open.filter(
          (alert) => stageForAlert(engagement, alert.type) === stage.id,
        )
      : [];

    return {
      ...stage,
      ...extras,
      actors: STAGE_ACTORS[stage.id](engagement),
      state:
        extras.state ??
        (done ? "done" : index === currentIndex ? "current" : "upcoming"),
      // A done stage with an open alert still reads as late, which is not a
      // contradiction: a stale title search is raised against a surveyor who
      // has sent everything they were asked for.
      //
      // The download-ready alerts are the exception, and the only alerts on this
      // file that mark a node without reddening it. They are raised by the
      // portal approving something, so nobody is behind -- a node gone red on
      // the day a CDC came through is the opposite of what the colour means. The
      // node still carries the alert and still says there is a step left; it
      // says so in green. See `hasPortalDownload`.
      isOverdue: alerts.some((alert) => !isPortalDownloadAlert(alert.type)),
      hasPortalDownload: alerts.some((alert) =>
        isPortalDownloadAlert(alert.type),
      ),
      alerts,
    } satisfies ComplianceStage;
  };

  const mainStages = main.map((stage, index) =>
    decorate(
      stage,
      {
        track: "main",
        isActive: true,
        branchesFrom: null,
        rejoinsAt: null,
      },
      index,
    ),
  );

  const approval = isActive
    ? developmentApplicationStage(engagement, now)
    : // A dormant branch has no clock and nothing on it to be done with, and
      // reading the real one would give it a start date off a lodgement that
      // does not exist. Emptied instead, which is what "this job is not on this
      // road" looks like.
      {
        ...developmentApplicationStage(engagement, now),
        done: false,
        startedAt: null,
        settledAt: null,
        elapsedBusinessDays: null,
        daysLeft: null,
      };

  const branch = decorate(
    approval,
    {
      track: "approval",
      isActive,
      branchesFrom: branchOrigin(engagement, mainStages),
      // Always the checklist. Whatever the job was doing when it took the
      // detour, what it comes back to is a certifier assessing it against a
      // list — the consent is what unfreezes that list, and the branch closing
      // anywhere else would be drawing a route the file cannot take.
      rejoinsAt: "CHECKLIST",
      // Not by index, which is what `currentIndex` decides and which is about
      // position on the main run. A branch is current when the job is actually
      // on it — the consent is outstanding and the checklist behind it is
      // frozen, which is the same reading the tab's own marker takes. A dormant
      // branch is upcoming for as long as it exists: not started, not skipped,
      // there.
      state: !isActive
        ? "upcoming"
        : approval.done
          ? "done"
          : checklistBlockedReason(engagement)
            ? "current"
            : "upcoming",
    },
    -1,
  );

  // Immediately before the node it rejoins at, which is where a detour belongs
  // in a list read top to bottom: everything above the branch happened before
  // it, everything below is what it feeds into.
  //
  // Found by id rather than by index. It was `slice(0, 4)`, and the portal stage
  // landing in the middle of this array is exactly the kind of edit that turns a
  // correct magic number into a branch drawn one node off with nothing failing
  // to say so.
  const rejoinIndex = mainStages.findIndex(
    (stage) => stage.id === branch.rejoinsAt,
  );
  const insertAt = rejoinIndex === -1 ? mainStages.length : rejoinIndex;

  return [
    ...mainStages.slice(0, insertAt),
    branch,
    ...mainStages.slice(insertAt),
  ];
}
