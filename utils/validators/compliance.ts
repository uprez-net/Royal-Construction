import {
  ComplianceAlertSource,
  ComplianceAlertType,
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
  /** An extra line on the outreach — "we need this by Friday". */
  note: normalizedStringSchema.optional(),
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
  /** It came back — or it did not, and somebody is un-ticking a mistake. */
  z.object({
    step: z.literal("received"),
    kind: applicationKindSchema,
    received: z.boolean(),
  }),
]);

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
 * data layer to the four types a certifier actually sends.
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
