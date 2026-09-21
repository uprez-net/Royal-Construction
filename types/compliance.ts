import {
  ComplianceAlertSource,
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceApprovalDecision,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceMeetingStatus,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  type Prisma,
} from "@prisma/client";

import { isNotRequired } from "@/constants/complianceDocuments";

/**
 * What a compliance read pulls in.
 *
 * Declared here rather than beside the queries because both the data layer and
 * the project detail payload use it, and `lib/data/compliance.ts` is a
 * `"use server"` module — importing a type out of one into a file a client
 * component reads would drag the whole action module along with it.
 */
export const certifierEngagementInclude = {
  documents: {
    include: { files: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  },
  /**
   * The certifier's own thread, and only it.
   *
   * The surveyor, architect and council threads share this table — same shape,
   * same components render them — and are told apart by `outreachId`. Without
   * the filter every message on the file landed in the certifier transcript,
   * which is both wrong and, on a job with three live threads, unreadable.
   */
  emails: { where: { outreachId: null }, orderBy: { sentAt: "asc" } },
  outreaches: {
    include: {
      emails: { orderBy: { sentAt: "asc" } },
      /**
       * What this party was asked for, and which checklist line asked.
       *
       * One row per document rather than the single column it replaced, which
       * is what lets a structural engineer answer three lines off one
       * engagement. Loaded here because both the row that offers the connect
       * control and the reply that files a document read it.
       */
      deliverables: true,
      /**
       * The architect's client meetings, newest first.
       *
       * Every one of them, including the reschedules. The tab only ever renders
       * the latest, but "what is this meeting up to" is answered by the row
       * before it as often as by the row itself — a meeting that has moved twice
       * is a different conversation with the architect from one booked for next
       * Tuesday, and the sweep reads the held one to start the plans clock.
       */
      meetings: { orderBy: { scheduledFor: "desc" } },
      /**
       * Rounds of client feedback on the plans, newest first.
       *
       * Loaded whole rather than filtered to the outstanding one. The card
       * shows how many rounds this set has been through, which is the honest
       * answer to "why are we still waiting", and the outstanding round is
       * found off the same array.
       */
      revisions: { orderBy: { requestedAt: "desc" } },
      /**
       * What the estate developer has been asked to approve, and what they said.
       *
       * DEVELOPER rows only and empty on every other party, loaded on the main
       * read because the two documents under covenant gate two different things
       * — the portal lodgement and the development application — and a gate that
       * has to fetch before it can decide whether to refuse is a button that
       * flickers through enabled on every render.
       *
       * At most two rows per file, so loading them whole costs nothing.
       */
      developerApprovals: true,
    },
    orderBy: { createdAt: "asc" },
  },
  /**
   * Every application to an outside body on this file.
   *
   * The 10.7 certificate, the road opening permit, the long service levy, the
   * mine subsidence approval, and the development application itself. Included
   * on the main read rather than fetched per block: each one decides which of
   * five states its block renders, and a card that has to fetch before it can
   * decide what it is flickers through all five.
   */
  externalApplications: {
    include: {
      /**
       * Every round this application has been lodged in, newest first.
       *
       * Loaded whole rather than filtered to the latest. The block shows how
       * many rounds a DA has been through, which is the honest answer to "why
       * is this still not determined", and the sweep reads the newest off the
       * same array — the same trade `revisions` above makes.
       */
      submissions: { orderBy: { round: "desc" } },
    },
  },
  /**
   * Open first, then newest.
   *
   * Resolved alerts stay on the read rather than being filtered out here: the
   * tab shows what was raised and settled as well as what is outstanding, and
   * a second query to find that out would be a second query on every render of
   * the project page.
   */
  alerts: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
} satisfies Prisma.CertifierEngagementInclude;

/** The engagement plus everything the Compliance tab renders, in one read. */
export type CertifierEngagementDetail = Prisma.CertifierEngagementGetPayload<{
  include: typeof certifierEngagementInclude;
}>;

export type ComplianceDocumentWithFiles =
  CertifierEngagementDetail["documents"][number];

export type CertifierEmailRecord = CertifierEngagementDetail["emails"][number];

/**
 * One file on the engagement, offered as something a message could carry.
 *
 * `documentLabel` first and the filename second, which is the order somebody
 * looking for one of these thinks in: a compliance file holds thirty documents
 * with names like "scan_0043.pdf" and "WhatsApp Image 2026-03-02 at
 * 11.14.02.jpeg", and picking by filename alone is guesswork. What the reader
 * knows is that they want the survey.
 */
export type VaultAttachmentOption = {
  fileId: string;
  filename: string;
  documentType: ComplianceDocumentType;
  documentLabel: string;
};

/**
 * The types that are never worth offering as an attachment.
 *
 * The two issued-item types are lines rather than documents -- what hangs off
 * a checklist item is whatever answered it, and it is already on the file under
 * its own type as well, so offering both puts the same PDF in the list twice
 * under a name the recipient would not recognise. UNKNOWN is worse: it is by
 * definition a document nobody has identified, and attaching one to an outbound
 * email means sending a third party something we cannot describe.
 */
const NOT_ATTACHABLE_FROM_VAULT: ReadonlySet<ComplianceDocumentType> = new Set([
  ComplianceDocumentType.UNKNOWN,
  ComplianceDocumentType.CHECKLIST_ITEM,
  ComplianceDocumentType.DA_ITEM,
]);

/**
 * Everything on the file that a message could sensibly carry.
 *
 * One helper rather than each modal filtering the document rows itself, because
 * the exclusions above are a judgement rather than a detail and four copies of
 * it would not stay in step. Sorted by label so the list reads alphabetically
 * by what a document *is*, which is the only ordering anybody can predict --
 * `order` is the pack's assembly order and means nothing to a person hunting
 * for the title search.
 *
 * `label` is passed through for the row that has one, so a mapped or extracted
 * row shows the wording it was given rather than a generic type name.
 */
export function vaultAttachmentOptions(
  engagement: Pick<CertifierEngagementDetail, "documents"> | null | undefined,
  labelFor: (
    documentType: ComplianceDocumentType,
    label?: string | null,
  ) => string,
): VaultAttachmentOption[] {
  const options = (engagement?.documents ?? [])
    .filter((document) => !NOT_ATTACHABLE_FROM_VAULT.has(document.documentType))
    .flatMap((document) =>
      document.files.map((file) => ({
        fileId: file.id,
        filename: file.filename,
        documentType: document.documentType,
        documentLabel: labelFor(document.documentType, document.label),
      })),
    );

  return options.sort(
    (a, b) =>
      a.documentLabel.localeCompare(b.documentLabel) ||
      a.filename.localeCompare(b.filename),
  );
}

/** One party's engagement plus its own mail trail, meetings and revisions. */
export type ComplianceOutreachDetail =
  CertifierEngagementDetail["outreaches"][number];

export type ComplianceMeetingRecord =
  ComplianceOutreachDetail["meetings"][number];

export type CompliancePlanRevisionRecord =
  ComplianceOutreachDetail["revisions"][number];

/** One application to an outside body, as the tab reads it. */
/**
 * The round an application's clock currently runs from.
 *
 * The newest submission, falling back to `appliedAt` for a row written before
 * the rounds table existed and never resubmitted since. Both are needed: the
 * fallback is what keeps every application already on the system measuring
 * against something, and the round is what stops a resubmitted DA reading as
 * late because of when it first went in.
 */
export function latestSubmission(
  application: ComplianceExternalApplicationRecord | null | undefined,
): { submittedAt: Date; round: number; applicationRef: string | null } | null {
  if (!application) return null;

  // Ordered newest-first by the include above, so the first is the latest. Not
  // re-sorted here: a caller that has ordered them differently is a bug worth
  // finding rather than one worth papering over.
  const newest = application.submissions?.[0];
  if (newest) {
    return {
      submittedAt: newest.submittedAt,
      round: newest.round,
      applicationRef: newest.applicationRef ?? application.applicationRef,
    };
  }

  if (application.appliedAt) {
    return {
      submittedAt: application.appliedAt,
      round: 1,
      applicationRef: application.applicationRef,
    };
  }

  return null;
}

export type ComplianceExternalApplicationRecord =
  CertifierEngagementDetail["externalApplications"][number];

/**
 * One kind of application on this file, or null before it is started.
 *
 * Null is the ordinary state for four of the five: nobody has answered "do we
 * already have this?" yet, and until somebody does there is no row.
 */
export function externalApplication(
  engagement:
    | Pick<CertifierEngagementDetail, "externalApplications">
    | null
    | undefined,
  kind: ComplianceExternalApplicationKind,
): ComplianceExternalApplicationRecord | null {
  return (
    engagement?.externalApplications.find(
      (application) => application.kind === kind,
    ) ?? null
  );
}

/** The 10.7 certificate application, or null before the question is answered. */
export function planningCertificate(
  engagement:
    | Pick<CertifierEngagementDetail, "externalApplications">
    | null
    | undefined,
): ComplianceExternalApplicationRecord | null {
  return externalApplication(
    engagement,
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
  );
}

/** The development application, or null before anything has been lodged. */
export function developmentApplication(
  engagement:
    | Pick<CertifierEngagementDetail, "externalApplications">
    | null
    | undefined,
): ComplianceExternalApplicationRecord | null {
  return externalApplication(
    engagement,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  );
}

export type ComplianceAlertRecord = CertifierEngagementDetail["alerts"][number];

/**
 * The outreach for one party, or undefined.
 *
 * There is at most one per party per file — the unique index says so — but
 * every caller was writing the same `.find` and the same enum comparison, and
 * a caller that forgets the file may have none at all is the caller that
 * crashes the tab.
 */
export function outreachForParty(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  party: CompliancePartyType,
): ComplianceOutreachDetail | undefined {
  return engagement?.outreaches.find((outreach) => outreach.party === party);
}

/**
 * Whether a party has been dealt with, one way or the other.
 *
 * Deliberately not "did the mail go out". A file where the client arrived with
 * their own survey has no mail and is nonetheless finished with the surveyor,
 * which is the whole point of SELF_SUPPLIED.
 *
 * Equally deliberately not "is there a row". An OUTREACH row still sitting at
 * NOT_SENT is what a send that threw after writing its row leaves behind, and
 * counting that as engaged unlocked the section, hid the button that would have
 * retried it, and told the architect the surveyor was under way — over a
 * surveyor who had never been written to at all.
 */
export function isPartyEngaged(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  party: CompliancePartyType,
): boolean {
  const outreach = outreachForParty(engagement, party);
  if (!outreach) return false;
  return (
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED ||
    outreach.status !== ComplianceOutreachStatus.NOT_SENT
  );
}

/** Alerts still waiting on somebody. */
export function openAlerts(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
): ComplianceAlertRecord[] {
  return (engagement?.alerts ?? []).filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );
}

/**
 * Whether an alert of this type is open on the file.
 *
 * The shape most callers want, because an alert's effect on the flow lasts
 * exactly as long as it is open: a DA_APPROVAL_REQUIRED that has been resolved
 * is history, and history must not still be suppressing the 10.7 certificate.
 */
export function hasOpenAlert(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
  type: ComplianceAlertType,
): boolean {
  return openAlerts(engagement).some((alert) => alert.type === type);
}

/**
 * Whether this job is going through as a development application.
 *
 * True from the moment somebody says so — the architect on a reply, the
 * certifier on their checklist, an admin by hand — and true afterwards for as
 * long as there is anything to show. The alert answers the first half and
 * closes when the consent lands; the application row answers the second, so a
 * job whose DA came through last month still has its DA block, its lodgement
 * date and its reference number on the tab rather than reverting to a screen
 * that never mentions the council.
 *
 * Deliberately not the same question as `requiresPlanningCertificate` below,
 * though they were one predicate for a while. That one asks whether the
 * certifier's pack still wants the 10.7 and goes back to true when the consent
 * arrives; this one asks whether the file has a development application on it
 * at all, and never goes back.
 */
export function hasDevelopmentApplication(
  engagement:
    | Pick<CertifierEngagementDetail, "alerts" | "externalApplications">
    | null
    | undefined,
): boolean {
  return (
    hasOpenAlert(engagement, ComplianceAlertType.DA_APPROVAL_REQUIRED) ||
    developmentApplication(engagement) !== null
  );
}

/**
 * Whether the development consent is on the file.
 *
 * The document, not the tick. Somebody marking the application received is
 * reporting it; the notice of determination being on the row is proving it —
 * and this is what unfreezes a checklist, so the stronger evidence is the one
 * that counts. A certifier asked to assess a job on the strength of a ticked
 * box has nothing to read.
 */
export function hasDevelopmentConsent(
  engagement: Pick<CertifierEngagementDetail, "documents"> | null | undefined,
): boolean {
  return (engagement?.documents ?? []).some(
    (document) =>
      document.documentType === ComplianceDocumentType.DEVELOPMENT_CONSENT &&
      document.files.length > 0,
  );
}

/**
 * Why the checklist cannot be worked on yet, or null.
 *
 * One condition today, and it is absolute rather than partial: a certifier who
 * has said the job needs development approval has nothing to assess until the
 * council has approved it. Every document on the checklist is evidence for an
 * assessment that cannot start, so collecting it now is work that may be thrown
 * away — the council routinely grants consent with conditions that change the
 * design, and every consultant report drawn against the old one is redone.
 *
 * The two halves of the file are not exclusive, which is the point. The DA runs
 * beside the checklist rather than instead of it: the DA list stays live so its
 * documents can be collected, and those of them the checklist also asks for
 * fill its rows as they land. What is frozen is only the checklist's own
 * controls and the send that would put the file in front of the certifier.
 *
 * Returns the sentence rather than a boolean, in the shape `partyBlockedReason`
 * and `packSendBlockedReason` already use, so the banner on the card and the
 * refusal from the review send are the same words.
 */
export function checklistBlockedReason(
  engagement:
    | Pick<CertifierEngagementDetail, "alerts" | "documents">
    | null
    | undefined,
): string | null {
  if (!hasOpenAlert(engagement, ComplianceAlertType.DA_APPROVAL_REQUIRED)) {
    return null;
  }
  if (hasDevelopmentConsent(engagement)) {
    // Belt and braces. The consent arriving resolves the alert on its own, so
    // reaching here means the resolve has not landed yet — a sweep that has not
    // run, or an upload whose after() is still in flight. Reading the document
    // as well means the checklist unfreezes on the upload rather than on the
    // bookkeeping that follows it.
    return null;
  }
  return "This job needs development approval before the certifier can assess anything. Collect the development application below; the checklist opens when the consent is on the file.";
}

/**
 * Whether the certifier's pack still wants the planning certificate.
 *
 * An open DA_APPROVAL_REQUIRED takes it out of the pack: the pack is what asks
 * a certifier to assess the job as complying development, and that question is
 * no longer being asked. It comes back if the alert is resolved as not applying
 * after all.
 *
 * Deliberately narrower than "is the certificate wanted at all", which it used
 * to be read as. A development application needs the same 10.7 certificate the
 * CDC path did — the council assesses against the same zoning and the same
 * overlays — so the certificate is not dropped when the job changes path, it
 * moves. The council block on the pack goes read-only and the block that
 * actually orders it appears on the development application, which is where the
 * document is now needed. Reading this as "not wanted" is what left a job on the
 * DA path with a council section saying the certificate had been replaced and
 * no way anywhere on the tab to order one.
 *
 * One predicate rather than the condition repeated, because it is read by the
 * progress count on the pack, and by the outreach that refuses to send an
 * incomplete pack — and the two disagreeing strands the engagement.
 */
export function requiresPlanningCertificate(
  engagement: Pick<CertifierEngagementDetail, "alerts"> | null | undefined,
): boolean {
  return !hasOpenAlert(engagement, ComplianceAlertType.DA_APPROVAL_REQUIRED);
}

/**
 * Which step an application block is on.
 *
 * A derived value rather than a stored column, because every one of these is
 * already implied by the fields underneath it and a second, stored account of
 * the same thing is a second thing to get out of step. The order is the order
 * the block walks through, and each step is the previous one plus one fact.
 *
 * - `unanswered` — nobody has said whether the builder already holds one.
 * - `held` — they do; the row is just waiting for the file.
 * - `to-order` — they do not, and nothing has been lodged. This is the portal
 *   link.
 * - `lodged` — an application is with the body. This is where the clock runs.
 * - `determined` — the body has decided it and sent no document. The clock has
 *   stopped and the file holds nothing.
 * - `received` — it has come back, whether or not the file is on the row yet.
 *
 * The same six steps for all seven kinds. A development application never
 * reaches `held` — nobody turns up already holding a DA for the house they
 * have not built — but the step is derived rather than declared per kind, and
 * an answer of false to a question the DA block never asks costs nothing.
 *
 * `determined` is the addition, and it is between `lodged` and `received` rather
 * than a flag on either because it is genuinely its own step: the NSW Planning
 * Portal determines a CDC, a construction certificate or a development
 * application and emails to say so without attaching anything. Before this, such
 * a file stayed on `lodged` — so the block went on reporting how many working
 * days the portal had had it, counting up, on an application that had already been
 * approved. Reading it as `received` was the other option and is worse: every
 * consumer of that step treats it as the document being here or imminent.
 */
export type ExternalApplicationStep =
  | "unanswered"
  | "held"
  | "to-order"
  | "lodged"
  | "determined"
  | "received";

export function externalApplicationStep(
  application: ComplianceExternalApplicationRecord | null,
): ExternalApplicationStep {
  if (!application || application.alreadyHeld === null) return "unanswered";
  // Ahead of `determined`, because `receivedAt` is the stronger claim of the two
  // and a row can carry both — a determination recorded off the portal email on
  // the Monday, the document ticked through on the Thursday.
  if (application.receivedAt) return "received";
  if (application.approvalNotifiedAt) return "determined";
  if (application.alreadyHeld) return "held";
  return application.appliedAt ? "lodged" : "to-order";
}

/**
 * The meeting the architect card is currently about, or null.
 *
 * The newest one that has not been superseded, which is either a booking still
 * to happen or the one that took place. A RESCHEDULED row is deliberately never
 * it: rescheduling writes the replacement, so the moved row is history the
 * moment its successor exists.
 */
export function currentMeeting(
  outreach: Pick<ComplianceOutreachDetail, "meetings"> | null | undefined,
): ComplianceMeetingRecord | null {
  return (
    outreach?.meetings.find(
      (meeting) =>
        meeting.status === ComplianceMeetingStatus.SCHEDULED ||
        meeting.status === ComplianceMeetingStatus.HELD,
    ) ?? null
  );
}

/**
 * When the client and the architect actually sat down, or null.
 *
 * The start of the preliminary-plans clock. Read off the meetings rather than
 * off the outreach, and off `heldAt` rather than off the booking, because a
 * meeting booked for a date and then held on another is common and the clock
 * has to run from the second.
 */
export function meetingHeldAt(
  outreach: Pick<ComplianceOutreachDetail, "meetings"> | null | undefined,
): Date | null {
  const held = (outreach?.meetings ?? []).filter(
    (meeting) => meeting.status === ComplianceMeetingStatus.HELD,
  );
  if (held.length === 0) return null;

  // The earliest one. A second meeting after the plans have been through a
  // round of revisions must not restart a clock that the first meeting began.
  return held.reduce<Date>((earliest, meeting) => {
    const at = meeting.heldAt ?? meeting.scheduledFor;
    return at < earliest ? at : earliest;
  }, held[0].heldAt ?? held[0].scheduledFor);
}

/**
 * The round of client revisions still waiting on the architect, or null.
 *
 * Null is the common case and means one of two very different things — no
 * revisions were ever asked for, or the last round was answered — which is why
 * callers testing this always test something else alongside it.
 */
export function outstandingRevision(
  outreach: Pick<ComplianceOutreachDetail, "revisions"> | null | undefined,
): CompliancePlanRevisionRecord | null {
  return (
    (outreach?.revisions ?? []).find(
      (revision) =>
        !revision.respondedAt &&
        // The client's rounds only. A developer's objection to the plans is
        // written against the same architect outreach, and counting it here made
        // it read as the client asking for changes — which put it in the rounds
        // the card reports and under ARCHITECT_REVISION_OVERDUE's clock, a
        // different wait with a different party behind it. Null is the client,
        // which is every row written before the column existed.
        revision.requestedBySource !== ComplianceAlertSource.DEVELOPER,
    ) ?? null
  );
}

/**
 * The round of developer objections still waiting on a redraw, or null.
 *
 * The counterpart of `outstandingRevision` over the same table, split by who
 * asked. Both exist because the architect's outreach now carries two independent
 * revision loops: the client's, which is the original, and the estate
 * developer's, which is a covenant refusal and goes back through the architect
 * in exactly the same way.
 */
export function outstandingDeveloperRevision(
  outreach: Pick<ComplianceOutreachDetail, "revisions"> | null | undefined,
): CompliancePlanRevisionRecord | null {
  return (
    (outreach?.revisions ?? []).find(
      (revision) =>
        !revision.respondedAt &&
        revision.requestedBySource === ComplianceAlertSource.DEVELOPER,
    ) ?? null
  );
}

export type ComplianceDeveloperApprovalRecord =
  ComplianceOutreachDetail["developerApprovals"][number];

/**
 * What the developer was asked about one document, or null.
 *
 * Null means the document has not been put to them — which is different from
 * their not having answered, and the difference is what the overdue clock reads:
 * a row exists from the moment the request goes out, so "with the developer since
 * Tuesday" is a fact the file holds rather than one inferred from silence.
 */
export function developerApprovalFor(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  documentType: ComplianceDocumentType,
): ComplianceDeveloperApprovalRecord | null {
  const developer = outreachForParty(engagement, CompliancePartyType.DEVELOPER);
  if (!developer) return null;

  // `?? []` for the same reason `revisions` and `meetings` are read that way: the
  // include guarantees the array, and a caller that projected the outreach without
  // it should get "nothing was put to them" rather than a crash.
  const row = (developer.developerApprovals ?? []).find(
    (approval) => approval.documentType === documentType,
  );
  if (row) return row;

  /**
   * The fallback onto the outreach's own columns.
   *
   * Every verdict recorded before `ComplianceDeveloperApproval` existed lives on
   * five columns of the outreach row, and all of them are about the bushfire
   * report — it was the only document under covenant at the time. The migration
   * copies them across, so this should never fire; it is here for the window
   * between `migrate deploy` and the deploy that follows it, during which new
   * code reads rows the backfill has written and old rows it has not.
   *
   * Synthesised rather than returned raw, so every caller sees one shape. Nothing
   * writes these columns any more.
   */
  if (
    documentType === ComplianceDocumentType.BUSHFIRE_REPORT &&
    developer.approvalDecision
  ) {
    return {
      id: `legacy:${developer.id}`,
      outreachId: developer.id,
      documentType,
      requestedAt: developer.sentAt ?? developer.createdAt,
      decision: developer.approvalDecision,
      decidedAt: developer.approvalDecidedAt,
      channel: developer.approvalChannel,
      reason: developer.approvalReason,
      round: 1,
      recordedById: developer.approvalDecidedById,
      createdAt: developer.createdAt,
      updatedAt: developer.updatedAt,
    } satisfies ComplianceDeveloperApprovalRecord;
  }

  return null;
}

/**
 * Whether the developer has approved one document.
 *
 * Deliberately not "have they answered". A rejection is an answer and is not an
 * approval, and every gate that reads this is asking the second question: a
 * refused set of plans must not let an application through to the portal.
 */
export function hasDeveloperApproval(
  engagement: Pick<CertifierEngagementDetail, "outreaches"> | null | undefined,
  documentType: ComplianceDocumentType,
): boolean {
  return (
    developerApprovalFor(engagement, documentType)?.decision ===
    ComplianceApprovalDecision.APPROVED
  );
}

/**
 * Why the developer's covenant blocks a lodgement on the plans, or null.
 *
 * The gate on both the CDC lodgement and the development application, which is
 * the whole of why the architectural design was brought under the covenant: a
 * pack lodged against plans the estate has not approved comes straight back, and
 * by then the application fee is spent and the clock has been running for a
 * fortnight.
 *
 * Null on the great majority of jobs, and there are two quite different reasons
 * for that which this collapses on purpose. A lot with no covenant on it is not
 * gated; neither is a lot whose developer has signed off. Both are "nothing is in
 * the way", and a caller that had to tell them apart would be a caller about to
 * explain a covenant to somebody who does not have one.
 *
 * Reads `developerApprovalRequired` first, which is the question the banner on
 * the tab asks. Null there means nobody has been asked yet — and that does *not*
 * block, deliberately: the answer is collected at the top of the engagement and a
 * file that somehow reached the portal without it should not be held up by a
 * question about an estate that probably does not exist. The banner is what
 * chases it.
 */
export function developerPlansBlockedReason(
  engagement:
    | (Pick<CertifierEngagementDetail, "outreaches" | "documents"> & {
        developerApprovalRequired: boolean | null;
      })
    | null
    | undefined,
): string | null {
  if (!engagement?.developerApprovalRequired) return null;

  // The DA list owns whether this document applies to the job. If it has been
  // waived there is no developer approval left to collect for it, even when an
  // older developer approval record is still present on the engagement.
  const plans = engagement.documents.find(
    (document) =>
      document.documentType ===
      ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
  );
  if (plans && isNotRequired(plans.status)) return null;

  const approval = developerApprovalFor(
    engagement,
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
  );

  if (approval?.decision === ComplianceApprovalDecision.APPROVED) return null;

  if (approval && approval.decision === ComplianceApprovalDecision.REJECTED) {
    // Their words, because "the developer said no" is not something anybody can
    // act on — the same reason the rejection is quoted into the mail that goes
    // back to the architect.
    return approval.reason
      ? `The estate developer has not approved the architectural design: "${approval.reason}" The plans have to be revised and re-approved before the application is lodged.`
      : "The estate developer rejected the architectural design. The plans have to be revised and re-approved before the application is lodged.";
  }

  if (approval) {
    return "The architectural design is with the estate developer for approval. Their covenant has to be satisfied before the application is lodged.";
  }

  return "This lot is in an estate whose developer has to approve the architectural design. Send the plans to them from the developer block before lodging the application.";
}

/**
 * One attachment as stored on `CertifierEmail.attachments`.
 *
 * A name and a url, nothing else. The bytes live in blob storage; the row only
 * has to be enough to render a download link inside a thread bubble.
 */
export interface CertifierEmailAttachment {
  name: string;
  url: string;
}

/**
 * Reads the attachments off an email row.
 *
 * The column is `Json`, so it is whatever was written there — including, for
 * rows predating a shape change, something that is not an array at all. Parsed
 * defensively so one malformed row renders an empty bubble rather than taking
 * the whole thread down.
 */
export function certifierEmailAttachments(
  value: unknown,
): CertifierEmailAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      const { name, url } = item as { name: string; url: string };
      return [{ name, url }];
    }
    return [];
  });
}

/**
 * What the extraction read about one checklist line beyond its name.
 *
 * Stored on `ComplianceDocument.detail` for a CHECKLIST_ITEM row. Every field is
 * optional and every field is the certifier's own words: this is transcription,
 * not our summary of their document, and a field the certifier did not write is
 * absent rather than invented.
 *
 * `version` follows `ProjectRequirementsPayload` (types/project-flow.ts) — the
 * shape will widen, and a stored blob has to say which shape it is. A new field
 * is added as optional with a comment saying why, never by migrating rows.
 */
export interface ChecklistItemDetail {
  version: 1;
  /**
   * The certifier's own numbering — "4a", "2", "14".
   *
   * Three jobs, which is why it is extracted rather than derived from position:
   * it is shown to the admin, it is the tie-break when a revised checklist is
   * matched against existing rows, and it is how a trailing note that names an
   * item by number is attached back to it.
   */
  clause?: string;
  /** The heading this item sat under — "Design Documentation". Stored so a row
   *  can say where it came from once the checklist card groups by it. */
  group?: string;
  /**
   * What the item actually is, where the label alone does not say.
   *
   * "Long Service Levy" is really "provide receipt of payments made to the Long
   * Service Payments Corporation for 0.25% of the construction cost" — the
   * label is the certifier's shorthand and this is the sentence explaining it.
   * Absent when the label already says everything.
   */
  description?: string;
  /**
   * The conditions this file has to satisfy, verbatim and in order.
   *
   * The nine amendments under "Architectural Plans" are the reason this column
   * exists: without them the admin uploads the plans, and the certifier sends
   * them back because the GFA sheet on A17 was never corrected.
   */
  requirements?: string[];
  /**
   * Standards, code clauses and external instruments the item cites.
   *
   * Never used as a lookup key. OCR misreads "section 88B" as "section 888" on
   * the checklist this was built against — legible to a person, wrong to a
   * matcher.
   */
  references?: string[];
  /**
   * The tracked type this line is asking for, where it is one we already hold.
   *
   * Display only: it is what lets a row say the certifier already has this,
   * next to the control that marks it not required. Nothing acts on it — the
   * decision to skip an item is the admin's, never inferred.
   */
  mapsToType?: ComplianceDocumentType;
}

/**
 * The checklist document's own metadata — what belongs to no single item.
 *
 * Stored on `ComplianceDocument.detail` for the CHECKLIST row, which is the
 * document these came off. Kept there rather than on the engagement so that
 * re-extracting a revised checklist overwrites them in the same step that
 * rewrites the items, instead of leaving a second place to remember.
 */
export interface ChecklistDocumentDetail {
  version: 1;
  /** The header block — project number, reference, site address, scope of works. */
  header?: { label: string; value: string }[];
  /** The trailing notes: full assessment does not start until everything lands;
   *  a CDC does not authorise commencement without an NOC and a PC appointment. */
  notes?: string[];
  certifier?: { name?: string; contact?: string; dated?: string };
}

/** Trims a value to a non-empty string, or null. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Trims a Json array to its non-empty strings. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const text = optionalString(item);
    return text ? [text] : [];
  });
}

/**
 * Reads the detail off a checklist item row.
 *
 * Defensive in the shape of `certifierEmailAttachments` above, and for the same
 * reason: the column is `Json`, so it holds whatever was written there —
 * including null for every row predating it, and whatever an older shape wrote.
 * A row that cannot be read renders as a plain row rather than taking the
 * compliance tab down.
 *
 * Returns null when there is nothing worth showing, so a caller can test the
 * result rather than testing each field.
 */
export function checklistItemDetail(
  value: unknown,
): ChecklistItemDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;

  const detail: ChecklistItemDetail = { version: 1 };
  const clause = optionalString(raw.clause);
  if (clause) detail.clause = clause;
  const group = optionalString(raw.group);
  if (group) detail.group = group;
  const description = optionalString(raw.description);
  if (description) detail.description = description;

  const requirements = stringList(raw.requirements);
  if (requirements.length) detail.requirements = requirements;
  const references = stringList(raw.references);
  if (references.length) detail.references = references;

  // Validated against the live enum rather than trusted: the blob may predate a
  // type being renamed, and an unknown string would otherwise reach the UI as a
  // document type nothing can render.
  const mapsToType = optionalString(raw.mapsToType);
  if (mapsToType && mapsToType in ComplianceDocumentType) {
    detail.mapsToType = mapsToType as ComplianceDocumentType;
  }

  // `version` alone is not content. A blob holding nothing else is the same as
  // no blob, and saying so here keeps every caller to one emptiness check.
  return Object.keys(detail).length > 1 ? detail : null;
}

/** Reads the checklist document's own metadata. Defensive, as above. */
export function checklistDocumentDetail(
  value: unknown,
): ChecklistDocumentDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const detail: ChecklistDocumentDetail = { version: 1 };

  if (Array.isArray(raw.header)) {
    const header = raw.header.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const label = optionalString(entry.label);
      const value = optionalString(entry.value);
      return label && value ? [{ label, value }] : [];
    });
    if (header.length) detail.header = header;
  }

  const notes = stringList(raw.notes);
  if (notes.length) detail.notes = notes;

  if (raw.certifier && typeof raw.certifier === "object") {
    const source = raw.certifier as Record<string, unknown>;
    const certifier: NonNullable<ChecklistDocumentDetail["certifier"]> = {};
    const name = optionalString(source.name);
    if (name) certifier.name = name;
    const contact = optionalString(source.contact);
    if (contact) certifier.contact = contact;
    const dated = optionalString(source.dated);
    if (dated) certifier.dated = dated;
    if (Object.keys(certifier).length) detail.certifier = certifier;
  }

  return Object.keys(detail).length > 1 ? detail : null;
}
