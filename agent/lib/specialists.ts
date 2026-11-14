/**
 * The operations specialists, in one place.
 *
 * Each `agent/subagents/<name>/agent.ts` takes its description from here, the
 * root `delegate` tool builds its input enum and model-facing description from
 * here, and the root agent's MCP-visible description lists the same areas. A
 * specialist added in one of those places and not the others would be either
 * unreachable or advertised without existing, so all three read this list.
 *
 * The key is the subagent's directory name, which is also its eve invocation
 * name for `ctx.agent(...)`.
 */
export const SPECIALISTS = {
  "lead-operations":
    "Handle authorized lead lookup and history; creating, editing, archiving and moving leads between pipeline stages; emailing the client; WhatsApp conversation reads, owner-approved sends and WhatsApp follow-ups; and follow-up and meeting tasks. Lead files are not available. Use only declared lead tools and return a typed result envelope.",
  "offer-operations":
    "Handle a lead's offer end to end: starting the first offer for a lead, authorized offer and revision lookup, full workspace detail review and targeted updates (area, pricing, cost lines, allowances, exclusions, payment schedule, and document draft), lifecycle transitions, emailing the Offer document to the client, DocuSign signing for the offer acceptance, Tender and Contract, recalls, revision creation, contract particulars, activity, signing status, schedule-list review, and handing a Contract-signed offer over into a project. Use exact revisions and state versions.",
  "project-operations":
    "Handle authorized project overview, the project's profit and loss (how a job is tracking: quoted price against tradie quotes and invoices, per activity) and repricing one activity within its contract-fixed stage price, the complete versioned requirements payload, compliance engagement/checklist evidence and gates, milestone reads/writes, and site manager assignment; then grow into files, schedules, communications, and audit history. Variation operations are intentionally not exposed until their business rules are finalized.",
  "compliance-operations":
    "Handle authorized compliance stages, documents, provenance, alerts, parties, meetings, follow-up, and readiness blockers.",
  "tradie-operations":
    "Handle authorized Royal Construction tradie directory records, incidents, ratings, approvals, and project schedule coordination. Its tools check the caller's access and project ownership themselves, so call them rather than refusing first; never expose variation or unrestricted contact data.",
  "admin-operations":
    "Handle Royal Construction admin approvals, offer-content defaults, the build sequence template for new projects (activity hierarchy/order/stages, estimated days, required tradie categories and related cost lines), team membership, and Xero connection administration. Its tools enforce admin-only access themselves, so call them rather than refusing first; changes require owner approval. Individual project milestones belong to project-operations.",
} as const;

export type SpecialistName = keyof typeof SPECIALISTS;

/**
 * The specialists the orchestrator may delegate to.
 *
 * compliance-operations is declared but owns no tools of its own: every
 * compliance tool lives under project-operations (see evals/README.md). A
 * specialist with nothing to call can only answer from its own imagination, so
 * it is not offered as a target until it owns tools; compliance requests route
 * to project-operations, whose description covers them. Its eve defaults are
 * disabled like every declared specialist's (tests/agent/specialist-default-tools.test.ts).
 */
export const DELEGATE_TARGETS = (
  Object.keys(SPECIALISTS) as SpecialistName[]
).filter((name) => name !== "compliance-operations") as [
  SpecialistName,
  ...SpecialistName[],
];
