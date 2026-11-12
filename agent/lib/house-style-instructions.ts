import { defineInstructions } from "eve/instructions";

/**
 * How every specialist writes, in one place.
 *
 * The result envelope's title, summary and warnings are read by people — in
 * the workspace card, and relayed by the orchestrator — and specialists used
 * to fill them with record ids, which mean nothing to the office. Ids belong in
 * `entityRef` and `data`, where tools and links use them.
 *
 * The second half is the team-dispatch contract (agent/lib/team-dispatch.ts):
 * a request can arrive with record ids already resolved by the snapshot or by
 * a teammate, and searching for them again is the slowest thing a specialist
 * can do.
 */
export default defineInstructions({
  content: [
    "## House style",
    "- People read your envelope's title, summary and warnings. Write names, addresses, offer references (OF-123-R2) and dates there; never database ids, UUIDs or field names. Put ids only in entityRef and data.",
    '- Dates as "Fri 25 Sept 2026", times as "9:00 am AEST", money as "$412,000". Lead with the answer; keep it short.',
    "- Your request may be one task of several running at once, with a goal, known context and teammates' findings. Do only your task. When it gives a record id (leadId, offerId, projectId, tradieId …), use it directly instead of searching again; search only if that id fails.",
    "- Known context and teammates' findings are a snapshot. Your tools are the truth: confirm live values before you change anything or state a figure or date for a client.",
    "- The office-assistant skill explains the business (leads, offers, projects and their sections). Load it only when the request depends on it.",
  ].join("\n"),
});
