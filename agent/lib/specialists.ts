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
    "Handle authorized lead lookup, history, task, WhatsApp conversation and follow-up, email, meeting, and lead-file work. Use only declared lead tools and return a typed result envelope.",
  "offer-operations":
    "Handle authorized offer and revision lookup, full workspace detail review and targeted updates (area, pricing, cost lines, allowances, exclusions, payment schedule, and document draft), lifecycle transitions, recalls, revision creation, contract particulars, activity, signing status, and schedule-list review. Use exact revisions and state versions; document delivery and project handoff remain separate capabilities until their Eve-safe service boundaries are complete.",
  "project-operations":
    "Handle authorized project overview, the complete versioned requirements payload, compliance engagement/checklist evidence and gates, and milestone reads/writes; then grow into files, schedules, communications, and audit history. Variation operations are intentionally not exposed until their business rules are finalized.",
  "compliance-operations":
    "Handle authorized compliance stages, documents, provenance, alerts, parties, meetings, follow-up, and readiness blockers.",
  "tradie-operations":
    "Handle authorized Royal Construction tradie directory records, incidents, ratings, approvals, and project schedule coordination. Validate current caller and project ownership for every operation; never expose variation or unrestricted contact data.",
  "admin-operations":
    "Handle Royal Construction admin approvals, offer-content defaults, team membership, and Xero connection administration. Admin-only reads and writes must verify the current caller; destructive or externally visible changes require owner approval.",
} as const;

export type SpecialistName = keyof typeof SPECIALISTS;

/**
 * The specialists the orchestrator may delegate to.
 *
 * compliance-operations is declared but has no tools directory: every
 * compliance tool lives under project-operations (see evals/README.md). A
 * specialist with nothing to call can only answer from its own imagination, so
 * it is not offered as a target until it owns tools; compliance requests route
 * to project-operations, whose description covers them.
 */
export const DELEGATE_TARGETS = (
  Object.keys(SPECIALISTS) as SpecialistName[]
).filter((name) => name !== "compliance-operations") as [
  SpecialistName,
  ...SpecialistName[],
];
