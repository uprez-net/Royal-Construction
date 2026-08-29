# WebMCP Phase Two — Rebalancing the Tool Surface

Companion to [webmcp-capability.md](./webmcp-capability.md), which describes the
system as built. This document is the plan of record for the phase-two change:
what moved, where it moved to, and why. Update the status column as phases land.

## Why

Phase one put 13 tools in a shared manifest and registered them on every
authenticated page. Two problems followed.

**The global registry carried tools that should not be global.** `get_projects`
returned whole project rows with stats — too large a payload for a tool result.
`get_all_tradies` returned the unfiltered directory, slowly, when `get_tradies`
already did the same read with a filter. `add_material` and the two variation
tools executed server-side against implementations the UI had moved past.

**Several tools had drifted from the UI they claimed to drive.**
`create_project_update` no longer matched how updates are posted. The headless
`add_milestone_photos` attached files nobody watched arrive.
`update_tradie_schedule` was not part of the current coordination flow.

## The model

The global registry holds cheap, always-relevant lookups. Everything else is
registered by the client component that owns the state, so the agent sees a tool
exactly when it is on the surface where that tool applies.

Mutations a human should witness — file uploads, outbound email, project
creation — open the existing UI and **stop**. They report that a person now has
to finish the action, and never claim it is done.

## Decisions

| Question | Decision |
| --- | --- |
| `send_lead_message` | Opens the composer pre-filled and stops. No mail leaves without a click. |
| Where the comms tools register | `lead-detail-screen.tsx`. The composer holds only a draft, and it mounts inside a modal — registered there, an agent could never see the tools unless a human had already opened the dialog. |
| `edit_milestone` | Split into four verbs, one per button in `milestone-action-button.tsx`. Each carries only the fields its transition needs, so a half-filled `DONE` cannot be composed. |
| Role gating | `useWebMcpTools` gained `requiredRole` and a role context. A filter on the menu, not a boundary — see the caveat in webmcp-capability.md. |
| Resolving a project after `get_projects` left | `get_project_lookup`, unchanged. It already returns `{id, name, location}` paginated. `get_leads` already returns a usable `id`. |
| `get_project_warnings` on two components | One tool at screen level with two sections. The header reads `requirements.legalAdministration`; the tradie alert reads `project.tradieSchedules`. Different state, same `ProjectDetail` prop. |
| HBCF vs HBFC | `hbcf` is correct and dominant (704 uses to 98). Tool names use it. Nothing renamed — `AdminOfferContent.hbfcClaim` is baked into a shipped migration, and a column rename is its own change. |

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Role gating + provider mount fix | done |
| 2 | Removals + reference cleanup | done |
| 3 | Navigation tools | done |
| 4 | Project detail reads | pending |
| 5 | Project detail writes | pending |
| 6 | Lead detail | pending |
| 7 | `OPERATING_GUIDE` rewrite | pending |
| 8 | Puppeteer smoke suite | pending |

## Target surface map

| Surface | Owning file | Tools |
| --- | --- | --- |
| Global (manifest) | `lib/tools/manifest.ts` | `get_customer`, `get_site_managers`, `get_tradies`, `get_project_lookup`, `get_project`, `get_leads`, `address_council_lookup` |
| Global (UI) | `components/webmcp/ui-tools.ts` | `get_current_view`, `navigate_to`, `get_operating_guide`, `navigate_to_project`, `navigate_to_lead` |
| Leads list | `components/leads/leads.tsx` | `leads_filter_by_stage`, `create_lead`, `update_lead`, `delete_lead` (admin) |
| Lead detail, any tab | `components/leads/detail/lead-detail-screen.tsx` | `upload_lead_files`, `navigate_to_lead_tab`, `get_lead_comms`, `send_lead_message` |
| Lead → HBCF card | `components/leads/detail/hbfc-claim-card.tsx` | `get_lead_hbcf_timeline` |
| Lead → overview tab | `components/leads/detail/lead-overview-tab.tsx` | `edit_lead_details` |
| Lead → documents tab | `components/leads/detail/lead-documents-tab.tsx` | `get_lead_files` |
| Projects list | `components/projects/projects-client.tsx` | `start_project_creation` |
| Project detail, any tab | `components/projects/project-detail-screen.tsx` | `upload_project_files`, `get_project_warnings` |
| Project tabs | `components/projects/detail/project-detail-tabs.tsx` | `navigate_to_project_tab` |
| Project → overview tab | `components/projects/detail/project-overview-tab.tsx` | `get_project_overview_details`, `set_and_update_project_overview_details` |
| Project → milestone tab | `components/projects/detail/project-milestones-tab.tsx` | `get_milestones`, `create_milestone`, `start_milestone`, `finish_milestone`, `set_milestone_not_required`, `update_milestone_details`, `add_milestone_photos` |
| Project → tradies tab | `components/projects/detail/project-tradies-tab.tsx` | `schedule_tradie` |
| Project → docs tab | `components/projects/detail/project-quotes-tab.tsx` | `get_project_files` |

## What broke on purpose

- **The MCP server lost tools.** The manifest feeds both transports, so removing
  `get_projects` and the variation tools removed them from `/api/mcp` too, and
  `get_milestones` follows in phase 4. There is no deprecation window. Existing
  Claude Code workflows using them break; `get_project_lookup` and `get_project`
  cover most of it.
- **`schedule_tradie` sends no outreach email** where the retired
  `create_tradie_schedule` did. That is the correction, not the regression: the
  modal has always used the bulk path, and the bulk path does not email. The
  single-row thunk emailed a tradie where a human click would not.

## Things found on the way, not fixed here

- `createTradieScheduleSchema.emailContent` is accepted and then ignored —
  `createTradieSchedule` generates its own outreach mail, and
  `bulkCreateTradieSchedules` sends none.
- `updateTradieScheduleSchema` still advertises `quote`/`quoteUnit`, which
  `PATCH /api/tradie-schedules/[id]` parses and drops.
- `VISIBLE_PROJECT_DETAIL_TABS` declares seven tabs but `payments` has no
  trigger, so it is reachable only by URL. The navigation tool does not offer it.
- `hooks/use-clerk-management.ts` posts to `/api/invitations`, which does not
  exist.
