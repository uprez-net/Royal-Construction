import { VariationStatus } from "@prisma/client";
import { z } from "zod";

export const activityLogSchemas = {
  projectCreated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    projectType: z.string(),
    location: z.string(),
    customerName: z.string(),
    customerEmail: z.email(),
    customerPhone: z.string(),
  }),

  siteManagerAssigned: z.object({
    projectId: z.string(),
    siteManagerName: z.string(),
    previousSiteManagerName: z.string().nullable(),
  }),

  projectStartDateChanged: z.object({
    projectId: z.string(),
    previousStartDate: z.string(),
    startDate: z.string(),
    milestonesRescheduled: z.number().int().nonnegative(),
  }),

  tradieScheduleCreated: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    cost: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
  }),

  tradieScheduleAvailable: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    cost: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
  }),

  tradieScheduleUpdated: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    cost: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
    approved: z.boolean(),
  }),

  tradieScheduleQuoted: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    quote: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
  }),

  tradieScheduleDeletionRequested: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    cost: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
    reason: z.string(),
  }),

  tradieScheduleRescheduled: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieName: z.string(),
    previousDate: z.string(),
    scheduleDate: z.string(),
    durationDays: z.number(),
    milestoneId: z.string().optional(),
    /** What the tradie was told: emailed, not emailed, or the email failed. */
    notice: z.enum(["emailed", "not-emailed", "email-failed"]),
  }),

  tradieScheduleDeleted: z.object({
    projectId: z.string(),
    scheduleId: z.string(),
    tradieId: z.string(),
    tradieName: z.string(),
    trade: z.string(),
    scheduleDate: z.string(),
    milestoneId: z.string().optional(),
    milestoneName: z.string(),
  }),

  variationCreated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    variationDescription: z.string(),
    variationAmount: z.string(),
  }),

  variationUpdated: z.object({
    projectId: z.string(),
    projectName: z.string(),
    variationDescription: z.string(),
    variationAmount: z.string(),
    status: z.enum(VariationStatus),
  }),

  fileUploaded: z.object({
    projectId: z.string(),
    milestoneId: z.string().optional(),
    fileId: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    fileSize: z.number(),
    origin: z.string().nullable().optional(),
  }),

  milestoneStatusChanged: z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    milestoneName: z.string(),
    oldStatus: z.string(),
    newStatus: z.string(),
  }),

  milestonePriceChanged: z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    milestoneName: z.string(),
    previousPrice: z.string(),
    price: z.string(),
  }),

  milestoneAdded: z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    milestoneName: z.string(),
  }),

  newMilestonePhotoUploaded: z.object({
    projectId: z.string(),
    milestoneId: z.string(),
    milestoneName: z.string(),
    fileCount: z.number(),
  }),

  // --- Compliance and certification -------------------------------------
  // Every payload carries projectId because ActivityLog.projectId is
  // non-null; the engagement is reached through the project, never the other
  // way round. The actor is named in the payload rather than in authorId,
  // which logAction does not persist.

  certifierOutreachSent: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    certifierEmail: z.string(),
    refToken: z.string(),
    documentCount: z.number(),
  }),

  certifierReplySent: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    certifierEmail: z.string(),
    attachmentCount: z.number(),
  }),

  certifierResponseReceived: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    emailFrom: z.string(),
    subject: z.string(),
    attachmentCount: z.number(),
  }),

  // --- Other parties on the compliance file -----------------------------
  // Same shape as the certifier entries above, plus the party, because the
  // one thing a reader of this trail needs that the certifier entries never
  // had to say is which of three concurrent threads a line is about.

  complianceOutreachSent: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    party: z.string(),
    contactEmail: z.string(),
    refToken: z.string(),
    attachmentCount: z.number(),
  }),

  complianceOutreachSelfSupplied: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    party: z.string(),
    recordedBy: z.string(),
  }),

  complianceOutreachResponseReceived: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    party: z.string(),
    emailFrom: z.string(),
    subject: z.string(),
    attachmentCount: z.number(),
  }),

  complianceAlertRaised: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    alertId: z.string(),
    alertType: z.string(),
    raisedBy: z.string(),
  }),

  complianceAlertResolved: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    alertId: z.string(),
    alertType: z.string(),
    resolvedBy: z.string(),
  }),

  /**
   * Every step of every application to an outside body, under one entry.
   *
   * `kind` and `step` rather than an entry type per application per state:
   * the trail is read as a story about one document, and fifteen kinds of
   * line for five rows' three states makes it harder to follow rather than
   * easier.
   */
  complianceExternalApplicationUpdated: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    kind: z.string(),
    step: z.string(),
    recordedBy: z.string(),
  }),

  /**
   * The certifier being appointed principal certifier on the portal.
   *
   * Its own entry rather than a step on the application above, because it is a
   * fact about the engagement rather than about a lodgement — one appointment
   * per job, and a job that has to relodge a CDC appoints nobody twice. It is
   * also the one gate on the CDC lodgement that nothing else on the file
   * records, so "why could we not lodge on the Tuesday" is a question only this
   * line can answer.
   */
  compliancePrincipalCertifierAppointed: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    appointedAt: z.string(),
    appointmentRef: z.string().nullable(),
    recordedById: z.string(),
    recordedByName: z.string(),
  }),

  /**
   * A consultant, or a portal, satisfying a checklist line from what the file
   * already held.
   *
   * Logged because it is the one thing on this tab that happens without
   * anybody clicking anything. An admin who opens the checklist and finds six
   * lines already answered is owed a record of what did that and where each
   * document came from — otherwise the only honest response to "why is item 4
   * ticked" is to go and read the code.
   */
  complianceChecklistMapped: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    mappedCount: z.number(),
    documentTypes: z.array(z.string()),
  }),

  /**
   * The architect being asked for the waste management plan.
   *
   * Its own entry rather than a party outreach, because nobody is engaged:
   * the request goes on a thread that has been open since the plans were
   * commissioned, and reading it as a new engagement would put a second
   * architect on the file.
   */
  complianceWasteManagementRequested: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    // No contactEmail. It is an external party's personal address, and this
    // log is persisted and rendered in the project feed -- `outreachId`
    // identifies the thread, and the outreach row holds the address for
    // anybody who actually needs it.
    outreachId: z.string(),
    attachmentCount: z.number(),
    requestedBy: z.string(),
  }),

  // --- The estate developer's sign-off ---------------------------------
  //
  // Four entries for one loop, because the loop can go round more than once
  // and the trail has to say which lap it is on. A file that reads "rejected"
  // then "revision requested" then "sent again" then "approved" is legible;
  // one that reads "approved" with no account of the fortnight before it is
  // not, and that fortnight is the part anybody asks about later.

  /**
   * The developer's answer.
   *
   * `channel` is the field that earns this entry its keep. An approval read
   * off an email by a model and one a person recorded after reading the same
   * email are the same fact with very different provenance, and the only
   * place that distinction survives is here.
   */
  complianceDeveloperDecision: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    decision: z.string(),
    channel: z.string(),
    reason: z.string().nullable(),
    decidedBy: z.string().nullable(),
    estate: z.string().nullable(),
  }),

  complianceBushfireRevisionRequested: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    revisionId: z.string(),
    reason: z.string(),
  }),

  complianceArchitectRevisionRequested: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    revisionId: z.string(),
    reason: z.string(),
  }),

  complianceBushfireRevisionReceived: z.object({
    projectId: z.string(),
    engagementId: z.string(),
  }),

  complianceDeveloperResent: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    attachmentCount: z.number(),
    requestedBy: z.string().nullable(),
  }),

  /**
   * Whether this estate needs a developer's approval at all.
   *
   * Logged because a "no" here opens the development application gate, and it
   * is answered by one person from memory of a contract of sale. If a pack
   * later comes back for want of an approval, this is the line that says who
   * said it was not needed and when.
   */
  complianceDeveloperApprovalRequirementSet: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    required: z.boolean(),
    answeredBy: z.string().nullable(),
  }),

  complianceDevelopmentApplicationRequirementSet: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    required: z.boolean(),
    answeredBy: z.string().nullable(),
  }),

  /**
   * What a council came back with on a development application.
   *
   * `unmatched` is the field worth having. A rejection we could not land on a
   * row is not a failure worth throwing on — the message is on the thread and
   * a person can place it — but it is the one thing here nobody would
   * otherwise know had happened.
   */
  /** The certifier issued the construction certificate. */
  complianceCertificateIssued: z.object({
    projectId: z.string(),
    engagementId: z.string(),
  }),

  /** The certificate and the HBCF cover are both on the file. */
  complianceCompleted: z.object({
    projectId: z.string(),
    engagementId: z.string(),
  }),

  complianceIssuedItemsRecorded: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    /** Which body wrote it, so the trail can say whose list grew. */
    assessor: z.string(),
    requestedCount: z.number(),
    rejectedCount: z.number(),
    unmatched: z.array(z.string()),
  }),

  complianceMeetingScheduled: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    meetingId: z.string(),
    scheduledFor: z.string(),
    /** Whether this replaced a meeting that had to move. */
    isReschedule: z.boolean(),
    recordedBy: z.string(),
  }),

  complianceMeetingHeld: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    meetingId: z.string(),
    heldAt: z.string(),
    recordedBy: z.string(),
  }),

  /**
   * The client's verdict on the preliminary plans, either way.
   *
   * One entry rather than two, because approval and a revision request are
   * the same decision with two outcomes and the trail should read as one
   * sequence of them. `feedback` is present only on a rejection.
   */
  compliancePlansReviewed: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    outreachId: z.string(),
    approved: z.boolean(),
    feedback: z.string().optional(),
    recordedBy: z.string(),
  }),

  complianceFollowUpSent: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    alertId: z.string(),
    alertType: z.string(),
    party: z.string(),
    contactEmail: z.string(),
    sentBy: z.string(),
  }),

  complianceDocumentUploaded: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    documentId: z.string(),
    documentLabel: z.string(),
    fileName: z.string(),
  }),

  complianceDocumentApproved: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    documentId: z.string(),
    documentLabel: z.string(),
    resolvedBy: z.string(),
  }),

  complianceDocumentNotRequired: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    documentId: z.string(),
    documentLabel: z.string(),
    resolvedBy: z.string(),
    notRequired: z.boolean(),
  }),

  complianceDocumentDismissed: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    documentId: z.string(),
    fileNames: z.array(z.string()),
    dismissedBy: z.string(),
  }),

  complianceDocumentRejected: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    documentId: z.string(),
    documentLabel: z.string(),
    resolvedBy: z.string(),
    rejectionReason: z.string(),
  }),

  checklistExtracted: z.object({
    projectId: z.string(),
    engagementId: z.string(),
    itemCount: z.number(),
  }),
};
