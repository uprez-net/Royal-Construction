import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceApprovalDecision,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  CompliancePartyType,
} from "@prisma/client";
import { z } from "zod";

import { idSchema, normalizedStringSchema } from "./common";
import { projectParamSchema } from "./projects";

// ============================================================================
// Route Parameters
// ============================================================================

/**
 * Project + compliance document route params, following the
 * `projectParamSchema.extend(...)` idiom the milestone and variation routes use.
 */
export const complianceDocumentParamSchema = projectParamSchema.extend({
  documentId: z.string().trim().min(1, "Document ID is required"),
});

export type ComplianceDocumentParam = z.infer<
  typeof complianceDocumentParamSchema
>;

/**
 * The checklist rows one early review send carries. Bounded because it is a
 * list of ids from the browser; a checklist is a few dozen lines at most.
 */
export const earlyReviewSendSchema = z.object({
  documentIds: z
    .array(z.string().trim().min(1, "Document ID is required"))
    .min(1, "Select at least one checklist document to send.")
    .max(100),
});

export type EarlyReviewSendInput = z.infer<typeof earlyReviewSendSchema>;

// ============================================================================
// Engagement
// ============================================================================

/**
 * Starting an engagement. `subjectAddress` becomes the human-readable half of
 * every subject line on the thread, so it is captured once here rather than
 * being re-derived from the project on each send — the project can be renamed,
 * and a renamed project must not break subject correlation on a live thread.
 */
export const startEngagementSchema = z.object({
  subjectAddress: z.string().trim().min(1, "A site address is required"),
  certifierName: normalizedStringSchema.optional(),
  certifierEmail: z.email().trim().toLowerCase(),
  certifierPhone: normalizedStringSchema.optional(),
});

export type StartEngagementInput = z.infer<typeof startEngagementSchema>;

// ============================================================================
// Party outreach
// ============================================================================

/**
 * Engaging a surveyor or an architect.
 *
 * `tradieId` is where the contact was picked from and the three snapshot fields
 * are what was picked — both are sent, and both are stored, for the reason
 * EnvelopeSignature snapshots its signers: the directory row can be edited or
 * deleted later, and a finished thread must not change who it was addressed to.
 *
 * The address is not taken from the tradie row on the server instead, because
 * a tradie may carry several (`additionalEmails`) and the person engaging them
 * is the one who knows which desk this job should land on.
 */
/**
 * Files the sender attached by hand, on top of what the party's table carries.
 *
 * Ids rather than urls, and that is the whole security argument: a caller who
 * could name a blob url could attach anything on the storage account to an
 * outbound email. An id is resolved against the File table by the data layer,
 * which is also what makes the name on the mail the stored name rather than one
 * the client chose.
 *
 * Every party outreach and every party mail accepts these. What
 * PARTY_OUTREACH_ATTACHMENTS holds is what a party always needs, worked out
 * from the document rows; this is the covenant schedule, the neighbour's
 * consent, the photograph of the pegs -- the things nobody could have listed in
 * advance, which turned out to be a normal part of every one of these
 * conversations rather than an edge case.
 */
export const extraAttachmentsSchema = z.array(idSchema).max(20).default([]);

export const startPartyOutreachSchema = z.object({
  party: z.enum(CompliancePartyType),
  tradieId: idSchema.optional(),
  contactName: normalizedStringSchema.optional(),
  contactEmail: z.email().trim().toLowerCase(),
  contactPhone: normalizedStringSchema.optional(),
  /** The reviewed and edited HTML body that will be sent to the party. */
  body: z
    .string()
    .trim()
    .min(1, "Email body is required")
    .max(100_000, "Email body is too long"),
  /**
   * The checklist line a consultant is being engaged against.
   *
   * Only meaningful for the two consultant parties, and ignored by the data
   * layer for the other three. A surveyor is engaged against the job; a BASIX
   * consultant is engaged against item 7, and what they send back answers that
   * item rather than becoming a document of its own.
   *
   * Names the line for the party's *first* deliverable. A structural engineer
   * answers three lines off one engagement, and which line each of their three
   * documents answers is `deliverables` below — this field stays for the
   * consultants that produce exactly one thing, which is where the whole
   * arrangement started.
   */
  checklistDocumentId: idSchema.optional(),
  /**
   * Every checklist line this engagement is meant to answer.
   *
   * One entry per document the party was asked for. Sent from the row that
   * offered the control, because only the tab knows which lines of the
   * certifier's checklist ask for which of the three things a structural
   * engineer produces — the server would have to guess by re-reading labels
   * the extraction has already read once.
   *
   * Empty is legitimate and common: on the development application path there
   * is no certifier checklist at all, and what comes back is filed under its
   * own type.
   */
  deliverables: z
    .array(
      z.object({
        documentType: z.enum(ComplianceDocumentType),
        checklistDocumentId: idSchema.optional(),
      }),
    )
    .default([]),
  /** Anything the sender attached by hand. See `extraAttachmentsSchema`. */
  extraAttachmentIds: extraAttachmentsSchema,
  /**
   * Which entry of AREA_DEVELOPERS this is, for a DEVELOPER outreach.
   *
   * Ignored for every other party. It is not the contact -- the address is
   * `contactEmail` above, like everybody else's, because the picker prefills it
   * and lets it be corrected. This is which estate was chosen, so the thread
   * can say so afterwards.
   */
  developerKey: normalizedStringSchema.optional(),
});

export type StartPartyOutreachInput = z.infer<typeof startPartyOutreachSchema>;

/**
 * Recording that the client already had this party's documents.
 *
 * Carries the party and nothing else. There is no contact, no address and no
 * mail — that is the whole distinction — and anything more here would be a
 * field with nowhere true to come from.
 */
export const partySelfSuppliedSchema = z.object({
  party: z.enum(CompliancePartyType),
});

export type PartySelfSuppliedInput = z.infer<typeof partySelfSuppliedSchema>;

// ============================================================================
// The estate developer's approval
// ============================================================================

/**
 * The developer's verdict on the bushfire report, as an admin records it.
 *
 * `reason` is required on a rejection and ignored on an approval, which is a
 * refinement rather than two schemas because it is one form with one submit and
 * the reader is answering one question. A rejection with no reasons is the case
 * this exists to prevent: those words are quoted verbatim to the bushfire
 * consultant who has to redo the report, and "the developer said no" costs
 * another eleven working days.
 */
/**
 * Which document under covenant a request or a verdict is about.
 *
 * Narrowed to the two rather than taking the whole document enum, which is what
 * makes a verdict against the survey a 400 rather than a row in a table that
 * nothing will ever read. Optional on every schema that takes it and defaulted in
 * the data layer to the bushfire report — see `recordDeveloperDecision` for why
 * that leniency is deliberate rather than an oversight.
 */
const developerDocumentSchema = z.enum([
  ComplianceDocumentType.BUSHFIRE_REPORT,
  ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
]);

export const developerDecisionSchema = z
  .object({
    documentType: developerDocumentSchema.optional(),
    decision: z.enum(ComplianceApprovalDecision),
    reason: normalizedStringSchema.optional(),
  })
  .refine(
    (input) =>
      input.decision !== ComplianceApprovalDecision.REJECTED
      || Boolean(input.reason?.trim()),
    {
      message:
        "Say why they rejected it — whoever produced the document is sent this word for word.",
      path: ["reason"],
    },
  );

export type DeveloperDecisionInput = z.infer<typeof developerDecisionSchema>;

/**
 * Putting a revised report back in front of the developer.
 *
 * No contact and no estate: the outreach already exists and this rides its
 * thread. What it carries beyond the report is a note and whatever the sender
 * attached, which is the same pair every other send here takes.
 */
export const developerResendSchema = z.object({
  documentType: developerDocumentSchema.optional(),
  note: normalizedStringSchema.optional(),
  extraAttachmentIds: extraAttachmentsSchema,
});

export type DeveloperResendInput = z.infer<typeof developerResendSchema>;

/**
 * Whether this lot needs a developer's approval at all.
 *
 * A bare boolean, and it is worth being clear that both values are answers.
 * `false` is not "we do not know" -- it is somebody saying this estate carries
 * no covenant, which is what opens the development application gate. Nobody
 * having been asked is the column being null, which no request can set.
 */
export const developerRequirementSchema = z.object({
  required: z.boolean(),
});

export type DeveloperRequirementInput = z.infer<
  typeof developerRequirementSchema
>;

/**
 * Who the estate developer is, answered off the banner.
 *
 * Supersedes `developerRequirementSchema` for the banner's own control and does
 * not replace it: the bare boolean is still what the development application
 * block's own yes/no writes, and both end up on the same column.
 *
 * The name is required when the answer is yes and forbidden-in-effect when it is
 * no, which the refine enforces rather than the field types. A covenant with
 * nobody behind it is the state the old flow left jobs in whose estate was not on
 * the checked-in list, and it is worse than an unanswered question: the gate
 * refuses the lodgement and there is nobody to send the plans to.
 *
 * The address is optional even on a yes, deliberately. An estate's approvals
 * address is on the covenant paperwork rather than published, and a wrong one is
 * much worse than a blank one — the request appears to have been sent, the clock
 * starts, and eleven working days later the file is chasing a bounce nobody read.
 * The send is what refuses without an address; recording who it is does not have
 * to wait for it.
 */
export const estateDeveloperSchema = z
  .object({
    required: z.boolean(),
    name: normalizedStringSchema.optional(),
    email: z.string().trim().check(z.email()).optional().or(z.literal("")),
    phone: normalizedStringSchema.optional(),
  })
  .refine((input) => !input.required || Boolean(input.name?.trim()), {
    message:
      "Name the developer — they are who the approval is sought from, and the plans cannot be sent to nobody.",
    path: ["name"],
  });

export type EstateDeveloperInput = z.infer<typeof estateDeveloperSchema>;
/** The browser's half — see `ExternalApplicationRequest`. */
export type EstateDeveloperRequest = z.input<typeof estateDeveloperSchema>;

/** Whether this compliance file needs a Development Application. */
export const developmentApplicationRequirementSchema = z.object({
  required: z.boolean(),
});

export type DevelopmentApplicationRequirementInput = z.infer<
  typeof developmentApplicationRequirementSchema
>;

// ============================================================================
// Applications to outside bodies
// ============================================================================

/**
 * A date the client sends as an ISO string and the server stores as an instant.
 *
 * `z.coerce.date()` would accept "banana" as an Invalid Date and hand it to
 * Prisma, which stores it as null and loses the field silently. This refuses
 * anything that does not parse, which is the difference between a 400 and a
 * clock that never starts.
 */
const isoDateSchema = z
  .string()
  .trim()
  .min(1, "A date is required")
  .transform((value, ctx) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "That is not a valid date." });
      return z.NEVER;
    }

    // A day that does not exist in the month it names.
    //
    // `new Date("2026-02-31")` does not fail — it rolls forward to 3 March, so
    // the NaN check above passes and a date nobody typed is stored. That value
    // becomes `ComplianceApplicationSubmission.submittedAt`, which is what the
    // determination clock counts from, so the silent correction moves an SLA
    // rather than just displaying oddly.
    //
    // Checked on the date-only form alone. Everything on this file comes off an
    // <input type="date"> and is `YYYY-MM-DD`; a full instant carries an offset,
    // and comparing its UTC components against the text would reject perfectly
    // good Sydney evenings.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      const rollsForward =
        parsed.getUTCFullYear() !== Number(year)
        || parsed.getUTCMonth() + 1 !== Number(month)
        || parsed.getUTCDate() !== Number(day);
      if (rollsForward) {
        ctx.addIssue({
          code: "custom",
          message: "That day does not exist in that month.",
        });
        return z.NEVER;
      }
    }

    return parsed;
  });

/**
 * Where one application has got to.
 *
 * A discriminated union rather than one object of optional fields, because the
 * three steps are three different acts against the same row and inferring which
 * one from the fields present got it wrong in the case that matters: an admin
 * correcting a typo in the application number looked identical to one lodging a
 * fresh application, and only the second is allowed to move the clock.
 *
 * `kind` rides every branch rather than sitting outside the union, because
 * `z.discriminatedUnion` discriminates on one key and the step is the one that
 * decides the shape. Repeating it three times is the price of that, and it is
 * cheaper than a wrapper object whose inner union every caller has to reach
 * through.
 */
const applicationKindSchema = z.enum(ComplianceExternalApplicationKind);

export const externalApplicationSchema = z.discriminatedUnion("step", [
  /** "Do you already have this?" — yes or no. */
  z.object({
    step: z.literal("answer"),
    kind: applicationKindSchema,
    alreadyHeld: z.boolean(),
  }),
  /**
   * An application is with the portal.
   *
   * The lodgement date is required and the other two are not, deliberately.
   * The date is the clock — without it there is nothing to measure and the
   * whole step records nothing useful — while the application number and the
   * council are what somebody needs to chase it, and are routinely not to hand
   * at the moment the application goes in.
   */
  z.object({
    step: z.literal("applied"),
    kind: applicationKindSchema,
    appliedAt: isoDateSchema,
    applicationRef: normalizedStringSchema.optional(),
    lodgedWith: normalizedStringSchema.optional(),
  }),
  /**
   * It went in again, after the body sent it back.
   *
   * Its own step rather than a second "applied", because the two mean different
   * things to the clock and to the trail. "applied" is the first lodgement and
   * sets the row up; this adds a round to it, and the round is what the overdue
   * sweep measures from — a DA resubmitted in April is not sixty working days
   * late for having first gone in in March.
   *
   * The reference is optional and carried forward when it is absent, because it
   * is usually the same number and occasionally is not: a council that closes an
   * application and asks for it to be relodged issues a new one, and chasing
   * round three by quoting round one's gets nowhere.
   */
  z.object({
    step: z.literal("resubmitted"),
    kind: applicationKindSchema,
    submittedAt: isoDateSchema,
    applicationRef: normalizedStringSchema.optional(),
    /** What this round carried — "revised A03 and A04, shadow diagram added". */
    note: normalizedStringSchema.optional(),
  }),
  /** It came back — or it did not, and somebody is un-ticking a mistake. */
  z.object({
    step: z.literal("received"),
    kind: applicationKindSchema,
    received: z.boolean(),
  }),
  /**
   * The portal has determined it, and has not sent the document.
   *
   * Its own step rather than part of "received", and the distinction is the whole
   * reason it exists. Every reader of `receivedAt` treats it as "the wait is
   * over, the document is here or is about to be" — and the NSW Planning Portal
   * determines a CDC, a construction certificate or a development application and
   * sends an email that carries nothing but the news. So there is a real state,
   * sometimes a week long, in which the application is decided and the file holds
   * nothing, and folding it into "received" would have the certificate block
   * offering an upload row for a document nobody had fetched while the stage above
   * it read as finished.
   *
   * What it actually buys is stopping the determination clock without claiming
   * the document: the certifier has done everything asked of them, so chasing
   * them is wrong, and the download-ready alert carries the step that is left.
   *
   * The date is optional and defaults to now. Unlike a lodgement — which an admin
   * is often recording days late off a portal receipt — this is almost always
   * entered the moment somebody reads the email, and making them confirm today's
   * date is a field nobody wants. Supplied where the email sat unread.
   */
  z.object({
    step: z.literal("determined"),
    kind: applicationKindSchema,
    determinedAt: isoDateSchema.optional(),
    applicationRef: normalizedStringSchema.optional(),
  }),
]);

/**
 * The principal certifier appointment, recorded off the portal.
 *
 * Its own schema rather than a step on the union above, because it is a fact
 * about the engagement rather than about an application — one appointment per job,
 * not one per lodgement, so a job that has to relodge a CDC appoints nobody a
 * second time. See `CertifierEngagement.principalCertifierAppointedAt`.
 *
 * The reference is optional on the same reasoning as a lodgement's: the date is
 * what the gate reads, and the portal's reference is what somebody needs in order
 * to chase the appointment, which is routinely not to hand at the moment the form
 * is submitted.
 */
export const principalCertifierSchema = z.object({
  appointedAt: isoDateSchema,
  appointmentRef: normalizedStringSchema.optional(),
});

export type PrincipalCertifierInput = z.infer<typeof principalCertifierSchema>;
/** The browser's half — see `ExternalApplicationRequest`. */
export type PrincipalCertifierRequest = z.input<
  typeof principalCertifierSchema
>;

/** What the data layer receives — dates already parsed into instants. */
export type ExternalApplicationInput = z.infer<
  typeof externalApplicationSchema
>;

/**
 * What the browser sends — dates still ISO strings.
 *
 * The two differ because `isoDateSchema` transforms, and the client half has to
 * be the pre-transform shape: a component typed against the output would be
 * asked for a `Date` and would send one that `JSON.stringify` turns back into
 * the string this parses. Same schema, both ends, neither pretending.
 */
export type ExternalApplicationRequest = z.input<
  typeof externalApplicationSchema
>;

// ============================================================================
// Client and architect meetings
// ============================================================================

/**
 * Booking the meeting, or moving it.
 *
 * One schema for both, because a reschedule is a booking that knows what it
 * replaces — and the thing it replaces is found on the server off the outreach
 * rather than named here, so a stale tab cannot close the wrong meeting.
 */
export const scheduleComplianceMeetingSchema = z.object({
  scheduledFor: isoDateSchema,
  /** Why it moved, on a reschedule. Sent to both sides on the invitation. */
  note: normalizedStringSchema.optional(),
  /**
   * Anything the sender attached by hand.
   *
   * The one invitation on this file that both the client and the architect
   * receive, so it is also the one place an agenda, a mood board or the
   * client's own sketches can reach both of them at once.
   */
  extraAttachmentIds: extraAttachmentsSchema,
});

export type ScheduleComplianceMeetingInput = z.infer<
  typeof scheduleComplianceMeetingSchema
>;

/** The browser's half — see `ExternalApplicationRequest`. */
export type ScheduleComplianceMeetingRequest = z.input<
  typeof scheduleComplianceMeetingSchema
>;

/**
 * What became of the meeting.
 *
 * "Took place" and "was rescheduled" are the two answers the resolution modal
 * offers, and the second carries the new time — which is what makes this a
 * union rather than a status plus an optional date nobody validates.
 */
export const resolveComplianceMeetingSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("held"),
    /**
     * When it actually happened, where that is not when it was booked.
     *
     * Optional, and the server falls back to the booked time. It matters
     * because the preliminary-plans clock runs from here: a meeting booked for
     * the 3rd and held on the 10th gives the architect a week that a fallback
     * to the booking would take away from them.
     */
    heldAt: isoDateSchema.optional(),
    note: normalizedStringSchema.optional(),
  }),
  z.object({
    outcome: z.literal("rescheduled"),
    scheduledFor: isoDateSchema,
    note: normalizedStringSchema.optional(),
    /**
     * Anything the sender attached by hand.
     *
     * Only on the reschedule branch, because only the reschedule sends a
     * message: recording a meeting as held is a note to ourselves about
     * something that already happened, and there is nobody to attach anything
     * to.
     */
    extraAttachmentIds: extraAttachmentsSchema,
  }),
]);

export type ResolveComplianceMeetingInput = z.infer<
  typeof resolveComplianceMeetingSchema
>;

/** The browser's half — see `ExternalApplicationRequest`. */
export type ResolveComplianceMeetingRequest = z.input<
  typeof resolveComplianceMeetingSchema
>;

// ============================================================================
// The waste management plan
// ============================================================================

/**
 * Asking the architect for the waste management plan.
 *
 * Carries what to send them and nothing about who they are, which is the whole
 * distinction from `startPartyOutreachSchema`. Nobody is being engaged: the
 * architect already has an outreach, a contact and a thread on this file, and a
 * contact on this request would be an invitation to send the plan request to
 * somebody who has never seen the design.
 *
 * The checklist line is optional because the same request is sent from two
 * places. Off a checklist item the certifier raised, it names that item so the
 * plan lands on it; off the development application list, there is no checklist
 * and the plan is filed under its own type.
 */
export const wasteManagementRequestSchema = z.object({
  /** An extra line on the request — "the certifier wants this by Friday". */
  note: normalizedStringSchema.optional(),
  /** The checklist line this answers, where it came off one. */
  checklistDocumentId: idSchema.optional(),
  /** Anything the sender attached by hand. See `extraAttachmentsSchema`. */
  extraAttachmentIds: extraAttachmentsSchema,
});

export type WasteManagementInput = z.infer<typeof wasteManagementRequestSchema>;

/** The browser's half. Identical today; declared for symmetry with the rest. */
export type WasteManagementRequest = z.input<
  typeof wasteManagementRequestSchema
>;

// ============================================================================
// Client review of the preliminary plans
// ============================================================================

/**
 * The client's verdict on the architect's preliminary plans.
 *
 * Feedback is required on a rejection and refused on an approval. Required
 * because it is the entire content of the mail the architect receives — a
 * revision request saying only "the client wants changes" is a phone call
 * somebody has to make anyway — and refused on approval because there is
 * nothing to say and nowhere it would be read.
 */
export const reviewArchitectPlansSchema = z
  .object({
    approved: z.boolean(),
    feedback: z.string().trim().optional(),
    /**
     * Anything the sender attached by hand.
     *
     * Carried on both outcomes and useful on one. A client rejecting a set of
     * plans routinely marks them up — a photograph of the printout, a sketch on
     * the back of an envelope — and the words alone lose exactly the part the
     * architect needs most.
     */
    extraAttachmentIds: extraAttachmentsSchema,
  })
  .superRefine((data, ctx) => {
    if (!data.approved && !data.feedback) {
      ctx.addIssue({
        code: "custom",
        path: ["feedback"],
        message:
          "Say what the client wants changed — it goes to the architect as written.",
      });
    }
  });

export type ReviewArchitectPlansInput = z.infer<
  typeof reviewArchitectPlansSchema
>;

// ============================================================================
// Alerts
// ============================================================================

/**
 * Raising an alert by hand.
 *
 * Both types can also be raised off an inbound message, but an admin reading a
 * reply the classifier did not act on has to be able to raise the same
 * condition — otherwise the flow depends on the extraction being right, and the
 * one case that matters most is the one it missed.
 */
export const raiseComplianceAlertSchema = z.object({
  type: z.enum(ComplianceAlertType),
  raisedBySource: z.enum(ComplianceAlertSource).optional(),
  detail: normalizedStringSchema.optional(),
});

export type RaiseComplianceAlertInput = z.infer<
  typeof raiseComplianceAlertSchema
>;

/**
 * Closing an alert.
 *
 * The note is required, not optional. What closed a condition is the only part
 * of it worth reading back later, and these two in particular are closed by a
 * judgement rather than by an event: somebody looked at the replacement title
 * search and decided it names the right owners.
 */
export const resolveComplianceAlertSchema = z.object({
  resolutionNote: z
    .string()
    .trim()
    .min(1, "Say what resolved this before closing it"),
});

export type ResolveComplianceAlertInput = z.infer<
  typeof resolveComplianceAlertSchema
>;

// ============================================================================
// Documents
// ============================================================================

/**
 * Attaching an already-uploaded blob to a compliance document.
 *
 * Only the id crosses the wire. The client uploads straight to Vercel Blob and
 * `/api/upload` writes the File row, so a url or a size supplied here would be
 * a second, untrusted account of a record that already exists.
 */
export const complianceDocumentUploadSchema = z
  .object({
    fileId: idSchema,
    /** A seeded required document, or an extracted checklist item. */
    documentId: idSchema.optional(),
    /**
     * The signed copies and home insurance have no row until one is uploaded,
     * so those uploads name a type instead of an id.
     */
    documentType: z.enum(ComplianceDocumentType).optional(),
    /**
     * Attach only if the row is still empty. Sent by an automatic filing,
     * never by a Replace control (`attachComplianceDocumentFile`).
     */
    ifEmpty: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.documentId && !data.documentType) {
      ctx.addIssue({
        code: "custom",
        path: ["documentId"],
        message: "Either a documentId or a documentType is required.",
      });
    }
  });

export type ComplianceDocumentUploadInput = z.infer<
  typeof complianceDocumentUploadSchema
>;

/**
 * The discovery probe, one document at a time.
 */
export const complianceDiscoverySchema = z.object({
  documentType: z.enum(ComplianceDocumentType),
});

/**
 * Labelling a received document the classifier left as UNKNOWN. Narrowed at the
 * data layer to `IDENTIFIABLE_DOCUMENT_TYPES`, the list the picker offers.
 */
export const classifyReceivedDocumentSchema = z.object({
  documentType: z.enum(ComplianceDocumentType),
});

export type ClassifyReceivedDocumentInput = z.infer<
  typeof classifyReceivedDocumentSchema
>;

export type ComplianceDiscoveryInput = z.infer<
  typeof complianceDiscoverySchema
>;

/**
 * Approve or reject one document.
 *
 * A rejection without a reason is rejected here rather than at the UI: the
 * reason is the only thing that tells whoever re-uploads what was wrong with
 * the first attempt, and the loop is unusable without it.
 */
export const resolveComplianceDocumentSchema = z
  .object({
    documentId: idSchema,
    decision: z.enum(["approved", "rejected"]),
    rejectionReason: normalizedStringSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "rejected" && !data.rejectionReason) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A reason is required when rejecting a document.",
      });
    }
  });

export type ResolveComplianceDocumentInput = z.infer<
  typeof resolveComplianceDocumentSchema
>;

/**
 * Marking a checklist line as not applying to this job, or putting it back.
 *
 * `notRequired` is explicit rather than a toggle so the request says what it
 * wants rather than what it wants to invert. Two admins clicking at once then
 * agree on the outcome instead of racing to flip it past each other.
 */
export const setComplianceDocumentNotRequiredSchema = z.object({
  documentId: idSchema,
  notRequired: z.boolean(),
});

export type SetComplianceDocumentNotRequiredInput = z.infer<
  typeof setComplianceDocumentNotRequiredSchema
>;

// ============================================================================
// Email
// ============================================================================

/**
 * One attachment on an outbound reply, as the composer knows it: a blob that
 * has already been uploaded.
 */
export const certifierReplyAttachmentSchema = z.object({
  fileId: idSchema,
  name: z.string().trim().min(1),
  url: z.url(),
});

export type CertifierReplyAttachment = z.infer<
  typeof certifierReplyAttachmentSchema
>;

export const certifierReplySchema = z.object({
  body: z.string().trim().min(1, "A message is required"),
  attachments: z.array(certifierReplyAttachmentSchema).default([]),
});

export type CertifierReplyInput = z.infer<typeof certifierReplySchema>;

/**
 * A message on one party's thread.
 *
 * Same shape as the certifier composer's plus the thread it goes on, because
 * the compliance file now has several and the composer is the same component
 * rendered once per tab. Declared here rather than beside the other party
 * schemas above so it sits after the attachment schema it is built from.
 */
export const partyReplySchema = z.object({
  outreachId: idSchema,
  body: z.string().trim().min(1, "A message is required"),
  attachments: z.array(certifierReplyAttachmentSchema).default([]),
  /** Rich editor output is sanitized server-side; ordinary thread replies stay plain. */
  bodyFormat: z.enum(["plain", "html"]).optional(),
  /** Extra files are resolved from trusted File rows rather than client URLs. */
  extraAttachmentIds: extraAttachmentsSchema.optional(),
});

export type PartyReplyInput = z.infer<typeof partyReplySchema>;

// ============================================================================
// Checklist extraction
// ============================================================================

/**
 * The checklist workflow trigger. `documentId` names the received CHECKLIST
 * document to read; the workflow re-reads its file itself rather than trusting
 * a url from the client.
 */
export const checklistExtractionRequestSchema = z.object({
  projectId: idSchema,
  engagementId: idSchema,
  documentId: idSchema,
});

export type ChecklistExtractionRequest = z.infer<
  typeof checklistExtractionRequestSchema
>;

// ============================================================================
// Home insurance
// ============================================================================

/**
 * The home-insurance step. "No" is a recorded answer, not an absence — it is
 * what sends the admin to icare, and the engagement should show that the
 * question was asked and answered rather than skipped.
 */
export const homeInsuranceSchema = z
  .object({
    raised: z.boolean(),
    fileId: idSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.raised && !data.fileId) {
      ctx.addIssue({
        code: "custom",
        path: ["fileId"],
        message: "Upload the certificate of insurance to record it as raised.",
      });
    }
  });

export type HomeInsuranceInput = z.infer<typeof homeInsuranceSchema>;
