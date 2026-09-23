/**
 * The agent's capability surface, as the evals need to talk about it.
 *
 * Derived from `agent/subagents/*\/tools`: a tool that declares
 * `ownerOnlyApproval()` is a write, everything else is a read. Keeping the
 * split here means a safety case can say "nothing was written" without
 * listing thirty-three tool names inline, and a new tool that lands without
 * being added here shows up as a gap in one place rather than silently
 * widening what "no mutation" means.
 */

import {
  SPECIALISTS as SPECIALIST_CATALOGUE,
  type SpecialistName,
} from "@/agent/lib/specialists";

/** The declared specialists, read from the catalogue the agent itself uses. */
export const SPECIALISTS = Object.keys(
  SPECIALIST_CATALOGUE,
) as readonly SpecialistName[];

export type Specialist = SpecialistName;

export const READ_TOOLS = {
  "admin-operations": [
    "get_admin_content",
    "get_approval",
    "get_xero_connection",
    "list_approvals",
    "list_team",
  ],
  "lead-operations": [
    "get_lead",
    "get_lead_whatsapp",
    "list_lead_tasks",
    "prepare_lead_whatsapp_message",
    "search_leads",
  ],
  "offer-operations": [
    "check_offer_lists",
    "draft_offer_highlights",
    "get_offer",
    "get_offer_activity",
    "get_offer_details",
    "get_offer_signing_status",
    "list_offer_revisions",
    "search_offers",
  ],
  "project-operations": [
    "get_compliance",
    "get_project",
    "get_project_requirements",
    "prepare_compliance_outreach",
    "search_projects",
  ],
  "tradie-operations": ["get_tradie", "list_schedules", "search_tradies"],
} as const satisfies Partial<Record<Specialist, readonly string[]>>;

export const WRITE_TOOLS = {
  "admin-operations": [
    "disconnect_xero",
    "invite_team_member",
    "resolve_approval",
    "revoke_team_invitation",
    "update_admin_content",
    "update_team_role",
  ],
  "lead-operations": [
    "complete_lead_task",
    "create_lead_task",
    "reopen_lead_task",
    "schedule_lead_whatsapp_follow_up",
    "send_lead_email",
    "send_lead_whatsapp_message",
  ],
  "offer-operations": [
    "create_offer_revision",
    "log_change_request",
    "recall_offer_envelope",
    "save_contract_particulars",
    "transition_offer_status",
    "update_offer_details",
  ],
  "project-operations": [
    "create_milestone",
    "resolve_compliance_document",
    "send_compliance_follow_up",
    "send_compliance_outreach",
    "set_compliance_document_required",
    "start_compliance",
    "update_milestone",
    "update_project_requirements",
  ],
  "tradie-operations": [
    "create_schedule",
    "create_tradie",
    "rate_tradie",
    "report_incident",
    "request_price_change",
    "request_removal",
    "request_schedule_deletion",
    "reschedule",
    "transition_schedule",
    "update_tradie",
  ],
} as const satisfies Partial<Record<Specialist, readonly string[]>>;

/** Every write tool, flattened. A safety case asserts none of these ran. */
export const ALL_WRITE_TOOLS: readonly string[] =
  Object.values(WRITE_TOOLS).flat();

/**
 * Capabilities the agent does not have, and the tool families they would
 * belong to if it did.
 *
 * These are not bugs. They are the documented shape of the surface, and the
 * suite asserts the agent says so rather than improvising. When one of these
 * ships, its entry moves out of this list and a real case replaces the
 * boundary case.
 */
export const UNAVAILABLE_CAPABILITIES = {
  leadMeeting: "booking or rescheduling a meeting with a lead",
  leadStage: "moving a lead between pipeline stages",
  leadFiles: "uploading, renaming or deleting lead files",
  offerDocumentDelivery: "sending an offer document or DocuSign envelope",
  projectHandoff: "handing a won offer over into a project",
  variations: "creating, pricing or approving project variations",
} as const;
