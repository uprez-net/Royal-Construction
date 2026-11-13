import { defineAgent } from "eve";
import { OPERATIONS_MODEL } from "@/lib/agent/model";
import { OPERATIONS_SESSION_LIMITS } from "@/lib/agent/session-limits";

/**
 * What an external MCP client learns about this agent before it calls it.
 *
 * eve publishes `description` as the lead of the `agent_start` tool
 * description on /eve/v1/mcp. Without it a client sees only the generic
 * invocation protocol and has to guess what the agent is for, what it may
 * change, and what to put in `message`.
 */
const description = [
  "Royal Constructions operations agent (Australian residential builder, staff-only): the office assistant that keeps the CRM up to date.",
  "It knows the live business (a nightly snapshot of every lead, project and tradie, refreshed after each change it makes), so short requests like 'where is the Rose St job up to' or 'move Smith to negotiating' work without ids.",
  "It reads and updates live business records through audited, permission-checked tools:",
  "leads (search, detail, create, edit, stage changes, archive, client email, follow-up and meeting tasks: create, complete, reopen; WhatsApp conversation reads, message previews, owner-approved sends and follow-up scheduling);",
  "offers and revisions (start an offer for a lead, search, detail, pricing, cost lines, allowances, exclusions, payment schedule, status transitions, emailing the offer to the client, DocuSign signing for the offer, Tender and Contract, recall, new revisions, change requests, contract particulars, activity, signing status, and handing a signed Contract over into a project);",
  "projects (search, overview, requirements, milestones, financials, site manager assignment);",
  "compliance on a project (engagement status, documents, certifier outreach and follow-up);",
  "tradies (directory, incidents, ratings, price-change and removal requests, site schedules);",
  "and admin (approval queue, offer-content defaults, build sequence templates with stages, hierarchy, estimated days, tradie category dependencies and related cost lines, team membership and invitations, Xero connection).",
  "Answers name records in plain English; ids are never shown.",
  "Every write or external side effect pauses as input_required for owner approval; the prompt names the exact records and change.",
  'Answer it with agent_update: optionId "approve" or "cancel", or pass the person\'s own words as text — a clear spoken yes ("yes, go ahead") or no ("no, hold off") is understood, and an unclear answer is rejected with a request to ask again, so nothing is approved on a guess.',
  "Not available through the agent: lead files; project variations.",
  "Put everything needed in `message`; each invocation starts a fresh conversation, and ambiguous targets come back as a question rather than a guess.",
  "Specialist work runs inside the invocation, so keep polling agent_get until it is terminal; a completed result is the finished answer.",
].join(" ");

export default defineAgent({
  description,
  model: OPERATIONS_MODEL,
  modelContextWindowTokens: 1_000_000,
  // The orchestrator routes, relays and answers from the snapshot; the
  // decisions are made by specialists, which keep "low". A reasoning pass
  // before every routing call was most of each step's time on staging (#429).
  reasoning: "none",
  defaultTools: false,
  compaction: {
    thresholdPercent: 0.75,
  },
  limits: OPERATIONS_SESSION_LIMITS,
});
