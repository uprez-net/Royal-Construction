import { Prisma, type Lead, type LeadStage } from "@prisma/client";

import type { DomainDb, TransactionalDomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import {
  attributionUserId,
  isOfficePrincipal,
  isOfficeRole,
  type DomainPrincipal,
} from "../principal";
import { authorizeLead } from "../access/leads";
import { LEAD_ROW_INCLUDE, type LeadRow } from "./row-read";
import {
  introducesOwnMailbox,
  OWN_MAILBOX_MESSAGE,
  ownMailboxRefusal,
} from "./client-email";
import {
  closeDatePatch,
  isClosedUnsuccessful,
  stageDef,
} from "@/lib/leads/pipeline-stages";
import { resolveLeadStage } from "@/lib/leads/resolve-stage";
import { LeadValidationError } from "@/lib/leads/lead-validation-error";
import { dropAlreadyRecorded } from "@/lib/leads/lead-history";
import {
  buildFollowupConfirmedHistoryEntry,
  buildFollowupNotRequiredHistoryEntry,
  buildFollowupRescheduledHistoryEntry,
  buildMeetingDidNotTakePlaceHistoryEntry,
  buildMeetingReviewedHistoryEntry,
  buildStageChangedHistoryEntry,
} from "@/lib/leads/lead-helpers";
import { offerListingLeadChanged } from "@/lib/offer/offer-listing-query";
import { coerceMoney } from "@/lib/leads/pipeline-math";
import {
  sydneyDateOnly,
  sydneyTimeOnly,
  sydneyWallClockToInstant,
} from "@/lib/dates/sydney";
import { historyTypeToPrisma, stageToPrismaMap } from "@/types/lead";
// Straight from the lead schemas, not the `utils/validators` barrel: that
// barrel re-exports `response.ts`, which imports `next/server`, and a value
// import of it would drag Next into every channel this command has to run in.
// The domain boundary test names exactly that chain.
import { requiredLeadEmail } from "@/utils/validators/lead";
import type { CreateLeadInput, UpdateLeadInput } from "@/utils/validators";
import { leadPhoneE164 } from "./whatsapp/phone";

// Creating, editing and archiving a lead.
//
// Phase 2 moved the shared lead rules — tasks, queries, the offer→lead stage
// projection — and left the lead record itself in `lib/data/leads.ts`, on the
// grounds that it was app-only with no second implementation to reconcile.
// That was true about duplication and wrong about authorization:
//
//   `PATCH /api/leads/[leadId]`, `DELETE /api/leads/[leadId]` and the MCP
//   update/delete tools acted on whatever id arrived. `proxy.ts` proves the
//   caller is signed in and not a GUEST, and stops there. So any CUSTOMER
//   account could edit any lead in the business, or archive it — the same
//   shape as the lead-task routes this migration already closed, on the
//   records the tasks hang off.
//
// `authorizeLead` is the rule that was already sitting there unused by these
// paths: internal roles reach every lead, anyone else only the leads assigned
// to them.
//
// Everything a customer sees or a notification reports stays with the adapter.
// The command returns what actually changed instead, so the adapter no longer
// has to infer it — see `LeadWriteOutcome`.

// The relations every lead write hands back are the ones every lead read
// does, so `mapLead` has one shape to accept. See `row-read.ts`.
export type LeadWithRelations = LeadRow;

export type CreateLeadOutcome =
  | { readonly kind: "created"; readonly lead: LeadWithRelations }
  | { readonly kind: "duplicate"; readonly existing: LeadWithRelations };

export type UpdateLeadOutcome = {
  readonly lead: LeadWithRelations;
  /**
   * Whether this request changed who the lead is assigned to.
   *
   * The adapter used to work this out by comparing `input.assignedId` with the
   * stored one. `assignedId` is optional, so an edit that did not mention it
   * compared `undefined` against a real id, came out unequal, and fired the
   * "assigned to you" notification — every note, every stage move, every save
   * told the assignee they had just been given a lead they already had.
   */
  readonly assignmentChanged: boolean;
  readonly previousAssignedId: string | null;
  readonly stageChanged: boolean;
  /** A field the cached offers list renders, so the adapter must expire it. */
  readonly listedFieldsChanged: boolean;
};

/**
 * Advisory-lock keys for the dedupe check.
 *
 * Sorted so two concurrent creates take them in the same order and cannot
 * deadlock against each other.
 */
function dedupeLockKeys(email: string, phone: string): string[] {
  return [
    email === "" ? null : `lead:email:${email.toLowerCase()}`,
    phone === "" ? null : `lead:phone:${phone}`,
  ]
    .filter((key): key is string => key !== null)
    .sort();
}

/**
 * Transaction-scoped advisory locks, held until the transaction completes, so
 * only one transaction can create a lead with the same identifying values.
 */
async function lockDedupeKeys(
  tx: Prisma.TransactionClient,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

/** Who may create a lead: the office, the public booking route, and crons. */
function assertMayCreateLead(principal: DomainPrincipal): void {
  // Deliberately permissive to the open callers. The booking route and the
  // inbound lead webhook are open by design — refusing an anonymous create here
  // would close the front door. What those callers must not do is name an
  // existing lead they cannot prove they own, and that is `authorizeLead`'s job
  // at their own boundary.
  //
  // A signed-in account outside the office is refused: a site manager does not
  // capture leads, and the duplicate answer below hands back the existing
  // lead's contact details, notes and email thread.
  if (principal.kind === "user" && !isOfficeRole(principal.role)) {
    throw new DomainAuthorizationError("Only the office can add a lead.");
  }
}

/**
 * A lead is assigned to the office, never to a site manager or a customer.
 *
 * Whoever holds a lead can read it (`canAccessLead` lets an assignee in), so
 * this is what keeps the sales side out of a site manager's reach. Checked on
 * the write rather than by narrowing `canAccessLead`: the read rule is shared by
 * every comms and listing path, and a refusal here is one the office can act on.
 */
async function assertOfficeAssignee(
  assignedId: string | null | undefined,
  db: DomainDb,
): Promise<void> {
  const id = assignedId?.trim();
  if (!id) return;
  const assignee = await db.user.findUnique({
    select: { role: true },
    where: { id },
  });
  if (!assignee) {
    throw new LeadValidationError(
      "That person could not be found. Pick someone else to assign.",
    );
  }
  if (!isOfficeRole(assignee.role)) {
    throw new LeadValidationError(
      "A lead can only be assigned to the office, not to a site manager.",
    );
  }
}

export type CreateLeadOptions = {
  /** The booking route sends its own confirmation; a second one is noise. */
  readonly skipWelcomeEmail?: boolean;
};

/**
 * Create a lead, or report the one that already has this email or phone.
 *
 * The dedupe is inside the transaction and behind advisory locks because two
 * submissions of the same public form land as two requests: without the lock
 * both read "no existing lead" and both insert.
 */
export async function createLead(
  principal: DomainPrincipal,
  input: CreateLeadInput,
  db: TransactionalDomainDb,
  options: CreateLeadOptions = {},
): Promise<CreateLeadOutcome> {
  assertMayCreateLead(principal);
  await assertOfficeAssignee(input.assignedId, db);
  void options;

  const mappedStage: LeadStage = input.stage
    ? stageToPrismaMap[input.stage]
    : "NEW";
  const createdValue = coerceMoney(input.estimatedValue);
  const actingUserId = attributionUserId(principal);

  // Same rule updateLead enforces: a lead cannot sit in LOST/CANCELLED/
  // DISQUALIFIED without a recorded reason. Enforced here too because a lead
  // can be created directly in a closed stage — the add-lead modal does not
  // offer one, but the API and the MCP create tool both accept it.
  if (isClosedUnsuccessful(mappedStage) && !input.lostReason?.trim()) {
    throw new LeadValidationError(
      `Add a reason before creating a lead in ${stageDef(mappedStage).label}.`,
    );
  }

  const historyCreate = (input.history ?? []).map((entry) => ({
    action: entry.action,
    detail: entry.detail ?? "",
    type: historyTypeToPrisma[entry.type],
    actionDate: entry.actionDate ?? new Date(),
    ...(actingUserId ? { authorId: actingUserId } : {}),
  }));

  if (historyCreate.length === 0) {
    const followUp = input.stage === "In Follow-up";
    historyCreate.push({
      action: followUp ? "Lead created with Follow-up set" : "Lead created",
      detail: followUp
        ? "Lead manually created and Also Assign the Follow-up Stage"
        : "Lead manually created",
      type: "SYSTEM",
      actionDate: new Date(),
      ...(actingUserId ? { authorId: actingUserId } : {}),
    });
  }

  // Every lead needs a valid primary email (#110). createLeadSchema enforces it
  // for callers that parse it, but direct callers (the consultation-booking
  // route) only null-checked truthiness — a non-empty but malformed address
  // slipped straight through. Re-validate at the write boundary so EVERY path
  // is covered, not just the schema-parsed ones.
  const emailCheck = requiredLeadEmail.safeParse(input.email);
  if (!emailCheck.success) {
    throw new LeadValidationError(
      emailCheck.error.issues[0]?.message ?? "Enter a valid client email",
    );
  }
  const normalizedEmail = emailCheck.data;
  const ownMailbox =
    ownMailboxRefusal(normalizedEmail)
    ?? ownMailboxRefusal(input.secondaryEmail);
  if (ownMailbox) throw new LeadValidationError(ownMailbox);
  const normalizedPhone = (input.phone ?? "").trim();

  const orConditions: Prisma.LeadWhereInput[] = [];
  if (normalizedEmail !== "") {
    orConditions.push({
      email: { equals: normalizedEmail, mode: Prisma.QueryMode.insensitive },
    });
  }
  if (normalizedPhone !== "") {
    orConditions.push({ phone: normalizedPhone });
  }

  return db.$transaction(async (tx) => {
    const lockKeys = dedupeLockKeys(normalizedEmail, normalizedPhone);
    if (lockKeys.length > 0) {
      await lockDedupeKeys(tx, lockKeys);

      const existing = await tx.lead.findFirst({
        where: { OR: orConditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: LEAD_ROW_INCLUDE,
      });
      if (existing) return { existing, kind: "duplicate" as const };
    }

    const lead = await tx.lead.create({
      data: {
        name: input.name,
        phone: normalizedPhone,
        // What inbound WhatsApp matches on (issue #333); null when the raw
        // phone does not normalise, which is also what keeps it unmatched.
        phoneE164: leadPhoneE164(normalizedPhone),
        email: normalizedEmail,
        location: input.location ?? "",
        secondaryName: input.secondaryName,
        secondaryEmail: input.secondaryEmail,
        secondaryPhone: input.secondaryPhone,
        source: input.source,
        sourceDetail: input.sourceDetail,
        stage: mappedStage,
        ...(input.assignedId
          ? { assignedUser: { connect: { id: input.assignedId } } }
          : {}),
        budget: input.budget,
        // A lead created with a value is manually owned until an offer exists;
        // the offer sync then takes over only if the source is not MANUAL.
        // Both fields derive from ONE parse so they cannot disagree — keying
        // the source off the raw input instead would make a typed 0 set a
        // value while leaving the source null.
        estimatedValue: createdValue,
        estimatedValueSource: createdValue === null ? null : "MANUAL",
        expectedCloseDate: input.expectedCloseDate ?? null,
        estimatedStartDate: input.estimatedStartDate ?? null,
        // A lead created directly in a closed stage needs its close date
        // stamped, exactly as the two update paths do.
        ...closeDatePatch(null, mappedStage, new Date()),
        type: input.type ?? [],
        notes: input.notes,
        meetingDate: input.meetingDate,
        meetingTime: input.meetingTime,
        meetingMode: input.meetingMode,
        followupDate: input.followupDate,
        followupTime: input.followupTime,
        followupNotes: input.followupNotes,
        followupReminderSentAt: input.followupReminderSentAt,
        meetingReminderSentAt: input.meetingReminderSentAt,
        lostReason: input.lostReason,
        urgent: input.urgent ?? false,
        history: { create: historyCreate },
      },
      include: LEAD_ROW_INCLUDE,
    });

    return { kind: "created" as const, lead };
  });
}

/**
 * Edit a lead, applying every rule both the modal and the API used to hold
 * separately, and refusing a caller the lead is not theirs to touch.
 */
export async function updateLead(
  principal: DomainPrincipal,
  id: number,
  input: UpdateLeadInput,
  db: TransactionalDomainDb,
): Promise<UpdateLeadOutcome> {
  await authorizeLead(principal, id, db);
  if (input.assignedId !== undefined) {
    await assertOfficeAssignee(input.assignedId, db);
  }

  const mappedStage = input.stage ? stageToPrismaMap[input.stage] : undefined;
  const updateData: Prisma.LeadUpdateInput = {};
  const actingUserId = attributionUserId(principal);

  // Read once, up front. Both the stage resolution below and the follow-up /
  // meeting branches need the current row, and this used to be two separate
  // findUnique calls that could disagree.
  //
  // History comes with it so the write below can tell a new entry from one the
  // caller has merely echoed back — see dropAlreadyRecorded.
  const existingLead = await db.lead.findUnique({
    where: { id },
    include: {
      history: { select: { action: true, detail: true, actionDate: true } },
    },
  });
  if (!existingLead) throw new DomainNotFoundError("Lead not found");

  if (input.name !== undefined) updateData.name = String(input.name);
  if (input.phone !== undefined) {
    updateData.phone = input.phone ?? "";
    // Kept in step with `phone` on every write, or inbound WhatsApp would
    // match the number the lead used to have.
    updateData.phoneE164 = leadPhoneE164(input.phone);
  }
  if (
    introducesOwnMailbox(input.email, existingLead.email)
    || introducesOwnMailbox(input.secondaryEmail, existingLead.secondaryEmail)
  ) {
    throw new LeadValidationError(OWN_MAILBOX_MESSAGE);
  }
  if (input.email !== undefined) updateData.email = input.email ?? "";
  if (input.location !== undefined) updateData.location = input.location ?? "";
  if (input.secondaryName !== undefined)
    updateData.secondaryName = input.secondaryName;
  if (input.secondaryEmail !== undefined)
    updateData.secondaryEmail = input.secondaryEmail;
  if (input.secondaryPhone !== undefined)
    updateData.secondaryPhone = input.secondaryPhone;
  if (input.source !== undefined) updateData.source = input.source;
  if (input.sourceDetail !== undefined)
    updateData.sourceDetail = input.sourceDetail;
  // NOTE: `stage` is deliberately NOT written here. The follow-up branches
  // further down can also set it, so both inputs are resolved together after
  // them and stamped once — see the resolveLeadStage call below.
  if (input.assignedId !== undefined) {
    const nextAssignedId = input.assignedId?.trim();
    updateData.assignedUser = nextAssignedId
      ? { connect: { id: nextAssignedId } }
      : { disconnect: true };
  }
  if (input.budget !== undefined) updateData.budget = input.budget;
  // Deal economics. updateData is an explicit whitelist — new columns do not
  // flow through on their own.
  if (input.estimatedValue !== undefined) {
    // coerceMoney, not `new Prisma.Decimal(...)` — Decimal THROWS on a
    // non-numeric or whitespace-only string, which would reject the entire
    // lead update (name, stage, notes and all) rather than one field.
    updateData.estimatedValue = coerceMoney(input.estimatedValue);
  }
  if (input.estimatedValueSource !== undefined)
    updateData.estimatedValueSource = input.estimatedValueSource;
  if (input.probabilityOverride !== undefined)
    updateData.probabilityOverride = input.probabilityOverride;
  if (input.expectedCloseDate !== undefined)
    updateData.expectedCloseDate = input.expectedCloseDate;
  if (input.estimatedStartDate !== undefined)
    updateData.estimatedStartDate = input.estimatedStartDate;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.notesDoc !== undefined)
    updateData.notesDoc = input.notesDoc as Prisma.InputJsonValue;
  // Setting a date reopens the task: a lead carries one meeting and one
  // follow-up at a time, so a fresh date must not inherit the last one's
  // completion stamp and show up already done.
  if (input.meetingDate !== undefined) {
    updateData.meetingDate = input.meetingDate;
    if (input.meetingDate !== null) updateData.meetingCompletedAt = null;
  }
  if (input.meetingTime !== undefined)
    updateData.meetingTime = input.meetingTime;
  if (input.meetingMode !== undefined)
    updateData.meetingMode = input.meetingMode;
  if (input.followupDate !== undefined) {
    updateData.followupDate = input.followupDate;
    if (input.followupDate !== null) updateData.followupCompletedAt = null;
  }
  if (input.followupTime !== undefined)
    updateData.followupTime = input.followupTime;
  if (input.followupNotes !== undefined)
    updateData.followupNotes = input.followupNotes;
  if (input.followupReminderSentAt !== undefined)
    updateData.followupReminderSentAt = input.followupReminderSentAt;
  if (input.meetingReminderSentAt !== undefined)
    updateData.meetingReminderSentAt = input.meetingReminderSentAt;
  if (input.lostReason !== undefined) updateData.lostReason = input.lostReason;
  if (input.urgent !== undefined) updateData.urgent = Boolean(input.urgent);

  const annotationInputs = input.annotationsToCreate ?? [];
  if (annotationInputs.length > 0) {
    updateData.noteAnnotations = {
      create: annotationInputs.map((annotation) => ({
        selectedText: annotation.selectedText,
        comment: annotation.comment,
        mentionedUserIds: annotation.mentionedUserIds,
      })),
    };
  }

  // Answering a follow-up closes the task. It used to null the date and write
  // stage CONTACTED, and that stage write was the only record the software had
  // that a follow-up had finished. It also cost a lead in negotiation 50 points
  // for a call being answered. followupCompletedAt carries the fact now, and
  // the date is kept so the tab can still show what was scheduled.
  if (
    input.followupResponseOutcome === "yes"
    || input.followupResponseOutcome === "notRequired"
  ) {
    updateData.followupCompletedAt = new Date();
    updateData.followupReminderSentAt = new Date();
  } else if (input.followupResponseOutcome === "reschedule") {
    const nextFollowupDate = new Date();
    nextFollowupDate.setDate(nextFollowupDate.getDate() + 1);
    updateData.followupDate = nextFollowupDate;
    updateData.followupTime =
      input.followupTime ?? existingLead.followupTime ?? null;
    updateData.followupReminderSentAt = null;
    updateData.followupCompletedAt = null;
  }

  // Single stage write. `stage` and `followupResponseOutcome` are independently
  // optional and both are exposed on the MCP surface, so they can arrive
  // together; resolveLeadStage decides which wins. The close-date stamp is
  // derived from the RESOLVED stage, never the requested one, so the stage
  // column and wonAt/lostAt can never describe two different transitions.
  const taskScheduled =
    input.followupResponseOutcome === "reschedule"
    || (input.followupDate !== undefined && input.followupDate !== null)
    || (input.meetingDate !== undefined && input.meetingDate !== null);

  const resolvedStage = resolveLeadStage({
    currentStage: existingLead.stage,
    requestedStage: mappedStage,
    taskScheduled,
  });
  if (resolvedStage !== undefined) {
    updateData.stage = resolvedStage;
    Object.assign(
      updateData,
      closeDatePatch(existingLead.stage, resolvedStage, new Date()),
    );
  }

  // Pipeline movement is the most reportable thing a lead does and it was the
  // one operator action that left no trace.
  const stageChanged =
    resolvedStage !== undefined && resolvedStage !== existingLead.stage;
  const stageHistory = stageChanged
    ? [buildStageChangedHistoryEntry(existingLead.stage, resolvedStage!)]
    : [];

  // Reason enforcement, mirroring the modal's check — which was the ONLY
  // enforcement, so a direct PATCH or the MCP tool could strand a lead in
  // LOST/CANCELLED/DISQUALIFIED with no reason. Those rows land in the
  // "Unknown" slice of the non-conversion charts, invisible to anyone auditing
  // why work was lost.
  //
  // It fires on the two things this request can be blamed for: moving a lead
  // INTO a closed-unsuccessful stage, and clearing the reason on one already
  // there. It deliberately does NOT fire on an unrelated edit to a lead that
  // is already closed with no reason — those rows predate the rule, and
  // blocking every edit would make them permanently uneditable, including the
  // edit that would supply the missing reason.
  const effectiveStage = resolvedStage ?? existingLead.stage;
  if (effectiveStage && isClosedUnsuccessful(effectiveStage)) {
    const enteringClosedStage =
      resolvedStage !== undefined && !isClosedUnsuccessful(existingLead.stage);
    const clearingReason =
      input.lostReason !== undefined && !input.lostReason?.trim();

    if (enteringClosedStage || clearingReason) {
      const reason =
        input.lostReason !== undefined
          ? input.lostReason
          : existingLead.lostReason;
      if (!reason?.trim()) {
        throw new LeadValidationError(
          `Add a reason before moving this lead to ${stageDef(effectiveStage).label}.`,
        );
      }
    }
  }

  if (input.meetingReviewOutcome === "no") {
    updateData.meetingReminderSentAt = new Date();
  } else if (input.meetingReviewOutcome === "yes") {
    updateData.meetingMode =
      input.meetingMode ?? existingLead.meetingMode ?? null;
    updateData.meetingReminderSentAt = new Date();
  }

  if (
    (input.history?.length ?? 0) > 0
    || annotationInputs.length > 0
    || stageHistory.length > 0
    || input.followupResponseOutcome
    || input.meetingReviewOutcome
  ) {
    const responseHistory =
      input.followupResponseOutcome === "yes"
        ? [buildFollowupConfirmedHistoryEntry()]
        : input.followupResponseOutcome === "notRequired"
          ? [buildFollowupNotRequiredHistoryEntry()]
          : input.followupResponseOutcome === "reschedule"
            ? [
                buildFollowupRescheduledHistoryEntry(
                  // Sydney, so the history line agrees with the date the
                  // operator picked rather than reading a day earlier all
                  // afternoon.
                  sydneyDateOnly(
                    (updateData.followupDate as Date | null | undefined)
                      ?? existingLead.followupDate
                      ?? new Date(),
                  ),
                  String(
                    updateData.followupTime ?? existingLead.followupTime ?? "",
                  ),
                ),
              ]
            : [];

    const meetingHistory =
      input.meetingReviewOutcome === "no"
        ? [buildMeetingDidNotTakePlaceHistoryEntry()]
        : input.meetingReviewOutcome === "yes"
          ? [
              buildMeetingReviewedHistoryEntry({
                meetingMode: String(
                  updateData.meetingMode
                    ?? existingLead.meetingMode
                    ?? input.meetingMode
                    ?? "Unknown",
                ),
                discussionNotes: String(input.discussionNotes ?? ""),
                buildScope: String(input.buildScope ?? ""),
              }),
            ]
          : [];

    const annotationHistory = annotationInputs.map((annotation) => {
      const now = new Date();
      return {
        action: "Lead note mention added",
        detail:
          annotation.comment || `Selected text: ${annotation.selectedText}`,
        type: "system" as const,
        date: sydneyDateOnly(now),
        time: sydneyTimeOnly(now),
      };
    });

    const toRow = (h: {
      action: string;
      detail?: string;
      type?: string;
      date: string;
      time?: string;
    }) => ({
      action: h.action,
      detail: h.detail || "",
      type: h.type
        ? (h.type.toUpperCase() as "SYSTEM" | "CALL" | "EMAIL" | "REFERRAL")
        : "SYSTEM",
      // Sydney, not the server's zone. The pair was produced by
      // sydneyDateOnly/sydneyTimeOnly, and reading it back as UTC put every
      // entry ten hours in the future.
      actionDate: sydneyWallClockToInstant(h.date, h.time),
      ...(actingUserId ? { authorId: actingUserId } : {}),
    });

    // The echo guard applies to CALLER-SUPPLIED history only.
    //
    // That is the only input that can contain rows the lead already has: the
    // email modal and the booking route both handed the whole list back, so
    // every row was inserted a second time. The entries built below it are
    // generated fresh here and can never be an echo, so they are NOT filtered
    // — and must not be. Their identity is action + detail + minute, and
    // several are constant by construction: every mention reads "Lead note
    // mention added", and a stage move repeated inside one minute produces the
    // same pair twice. Filtering them dropped the later, real entry.
    const created = [
      ...dropAlreadyRecorded(
        (input.history ?? []).map(toRow),
        existingLead.history,
      ),
      ...responseHistory.map(toRow),
      ...meetingHistory.map(toRow),
      ...annotationHistory.map(toRow),
      ...stageHistory.map(toRow),
    ];

    if (created.length > 0) updateData.history = { create: created };
  }

  const listedFieldsChanged = offerListingLeadChanged(existingLead, updateData);

  // Hand the lead's outstanding work over IN THE SAME TRANSACTION as the lead
  // write. Split across two round trips, a failure on the second left the lead
  // showing a new owner while its open tasks still pointed at the old one and
  // still emailed them — the exact bug this reassignment exists to fix,
  // reintroduced in a narrower window.
  //
  // Only open tasks move: a completed task records who actually did the work.
  const lead = await db.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: updateData,
      include: LEAD_ROW_INCLUDE,
    });
    if (input.assignedId !== undefined) {
      await tx.leadTask.updateMany({
        where: { completedAt: null, leadId: id },
        data: { assignedId: input.assignedId?.trim() || null },
      });
    }
    return updated;
  });

  const nextAssignedId = input.assignedId?.trim() || null;
  return {
    // Only a request that actually names an assignee can change one. An edit
    // that leaves `assignedId` out is not a reassignment, however the stored
    // value compares against `undefined`.
    assignmentChanged:
      input.assignedId !== undefined
      && nextAssignedId !== existingLead.assignedId,
    lead,
    listedFieldsChanged,
    previousAssignedId: existingLead.assignedId,
    stageChanged,
  };
}

/**
 * Archive a lead.
 *
 * Soft delete, so the row survives for auditing — but it disappears from every
 * list, which is destructive enough that "any signed-in account may archive
 * any lead" was the wrong answer. Internal staff only: a CUSTOMER who can see
 * their own lead still has no business retiring it.
 */
export async function archiveLead(
  principal: DomainPrincipal,
  id: number,
  db: DomainDb,
): Promise<{ id: number; alreadyArchived: boolean }> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Archiving a lead requires internal staff access.",
    );
  }
  const existing = await db.lead.findUnique({
    select: { id: true, isArchived: true },
    where: { id },
  });
  if (!existing) throw new DomainNotFoundError("Lead not found");
  if (existing.isArchived) return { alreadyArchived: true, id: existing.id };

  await db.lead.updateMany({
    data: { isArchived: true },
    where: { id, isArchived: false },
  });
  return { alreadyArchived: false, id: existing.id };
}

export type { Lead };
