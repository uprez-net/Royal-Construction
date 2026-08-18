import type { Lead } from "./types";
import { isQuotingStage, isTerminalStage } from "./lead-helpers";

/**
 * One source of truth for "may the operator do this to this lead?".
 *
 * These rules lived inline in `views/table-view.tsx`, duplicated between the
 * desktop table and the mobile card list — and they had already drifted: the
 * desktop "Send message" button was gated on `lead.email`, the mobile one was
 * not, so an emailless lead offered a messaging surface that cannot address
 * anyone. The desktop rule is the correct one (LeadCommModal is an email
 * thread) and is what this module encodes for every caller.
 */
export interface LeadActionState {
  /** Whether the control renders at all. */
  visible: boolean;
  /** Whether the control renders but rejects interaction. */
  disabled: boolean;
  /**
   * Why the action cannot be taken right now, for a tooltip/title. `null`
   * whenever the action is available, so a caller can pass it straight through.
   */
  disabledReason: string | null;
}

export interface LeadActions {
  /** Dial the lead's phone number. */
  call: LeadActionState;
  /** Open the templated follow-up email composer. */
  email: LeadActionState;
  /** Open the message thread — labelled "Send Text" on the detail page. */
  sendText: LeadActionState;
  /** Archive the lead — labelled "Delete Lead" on the detail page. */
  archive: LeadActionState;
  /** Jump to the consultation booking flow. */
  bookMeeting: LeadActionState;
  /** Open this lead's offer workspace — "Check with Offer". */
  checkOffer: LeadActionState;
}

const ARCHIVED = "This lead is archived, so it can no longer be actioned.";

const available: LeadActionState = {
  visible: true,
  disabled: false,
  disabledReason: null,
};

const hidden: LeadActionState = {
  visible: false,
  disabled: true,
  disabledReason: null,
};

/** Visible, but blocked with a reason the UI can show. */
function blocked(reason: string): LeadActionState {
  return { visible: true, disabled: true, disabledReason: reason };
}

export function leadActions(lead: Lead): LeadActions {
  // Archiving is the one terminal-only action, and an already-archived lead
  // cannot be archived again — that is the whole of the guard in table-view.
  const archive = !isTerminalStage(lead.stage)
    ? hidden
    : lead.isArchived
      ? blocked("This lead is already archived.")
      : available;

  const gate = (visible: boolean): LeadActionState =>
    !visible ? hidden : lead.isArchived ? blocked(ARCHIVED) : available;

  return {
    // Deliberately not also gated on `lead.phone` — that is the list view's
    // long-standing rule and widening it here would silently remove the Call
    // button from rows that render it today.
    call: gate(!isTerminalStage(lead.stage)),
    email: gate(Boolean(lead.email)),
    sendText: gate(Boolean(lead.email)),
    archive,
    bookMeeting: gate(true),
    checkOffer: gate(isQuotingStage(lead.stage)),
  };
}

/**
 * The offer workspace for a lead. The route self-provisions the Offer row, so
 * this is safe to link even for a lead that has never been priced.
 */
export function offerWorkspaceHref(lead: Lead): string {
  return `/offers/${lead.id}`;
}

/**
 * The consultation booking URL used by every "book a meeting" affordance.
 * Kept here so the detail page and the list view cannot drift on parameters.
 */
export function bookConsultationHref(
  lead: Lead,
  teammateName: string | null | undefined,
): string {
  const params = new URLSearchParams({
    TeammateName: teammateName ?? "",
    name: lead.name,
    email: lead.email,
    id: String(lead.id),
  });

  return `/book-consultation?${params.toString()}`;
}
