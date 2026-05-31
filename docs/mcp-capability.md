# MCP Capability

This document describes the current MCP server implementation in this repository, the tools it exposes, the inputs each tool accepts, and how a client can connect to it.

The implementation lives in [app/api/mcp/route.ts](../app/api/mcp/route.ts). The server is built with `mcp-handler`, wraps requests with Clerk-based auth, and exposes a tool registry through `server.registerTool(...)`.

## How It Works

At a high level, the MCP server follows this flow:

1. A client connects to the MCP endpoint.
2. The request passes through the `withMcpAuth(...)` wrapper.
3. Clerk verifies the bearer token and attaches auth context to the request.
4. `createMcpHandler(...)` creates the MCP server instance.
5. Each tool validates its input with Zod schemas from `utils/validators/*`.
6. The tool handler calls the matching `lib/data/*` helper or a direct integration helper.
7. The result is returned as structured MCP content and also serialized as text for client compatibility.

Most read tools call cached helpers such as `getCachedProjects(...)`, `getCachedProjectById(...)`, `getCachedTradies(...)`, and `getCachedTradieCoordinationDashboard(...)`. Write tools call the underlying mutation helpers directly and then return the newly created or refreshed payload.

Two design choices matter when you use the server:

- the tool schemas are intentionally close to the route validators, so the MCP contract mirrors the HTTP API
- write tools usually return a full refreshed entity rather than a partial success message, which makes them easier to use from agents that need the latest state immediately

## Authentication

The MCP server is protected.

- Requests must present a valid Clerk bearer token.
- The auth wrapper uses `withMcpAuth(...)` and the request must satisfy the required scope configured by the server.
- Tools that mutate data also depend on the authenticated user context.

In practice, MCP clients need to support bearer-token or OAuth-style auth. If a client cannot attach an access token, it will not be able to call the protected tools.

## Available Tools

The table below reflects the current tool registry in [app/api/mcp/route.ts](../app/api/mcp/route.ts).

| Tool | Purpose | Inputs | Output |
| --- | --- | --- | --- |
| `get_customer` | Search customers for dropdowns and project creation | `page`, `limit`, `q`, `search` | Paginated customer list |
| `get_site_managers` | Search site managers for assignment | `page`, `limit`, `q`, `search` | Paginated site manager list |
| `get_tradies` | Search tradies for lookup and scheduling | `search`, `q`, `limit`, `page` | Tradie list |
| `get_projects` | List projects with summary stats | `status`, `page`, `limit`, `search`, `sortBy`, `sortOrder` | Paginated project list |
| `get_project_lookup` | Lookup projects for autocomplete | `page`, `limit`, `q` | Paginated project lookup list |
| `get_project` | Fetch a full project detail payload | `projectId` | Project detail payload |
| `create_project` | Create a project | `name`, `location`, `budget`, `startDate`, `lotSize`, `customerMode`, optional `customerId`, optional `customerName`, optional `customerEmail`, optional `customerPhone`, optional `siteManagerId`, optional `notes`, optional `quoteFile` | Refreshed project detail payload |
| `create_project_update` | Create a project site update | `projectId`, `notes`, optional `milestoneId`, optional `photoUrls` | Refreshed project detail payload |
| `create_variation` | Create a variation for a project | `projectId`, `description`, `cost`, optional `requestedDate` | Variation payload |
| `update_variation_status` | Approve or reject a variation | `projectId`, `variationId`, `status` | Variation payload |
| `get_milestones` | List milestones for a project | `projectId` | Milestone array |
| `create_milestone` | Create a milestone | `projectId`, `name`, optional `description`, `targetDate`, `budget`, optional `parentId` | Milestone payload |
| `add_milestone_photos` | Attach uploaded files to a milestone | `projectId`, `milestoneId`, `fileIds` | Milestone photo attachment payload |
| `update_milestone` | Update milestone status or dates | `projectId`, `milestoneId`, `status`, optional `startDate`, optional `actualDate`, optional `spend` | Milestone payload |
| `get_leads` | List all leads | No inputs | Lead array |
| `create_lead` | Create a lead | `name`, optional `phone`, optional `email`, optional `location`, optional `source`, optional `stage`, optional `assigned`, optional `budget`, optional `notes`, optional `followupDate`, optional `followupTime`, optional `followupNotes`, optional `lostReason`, optional `urgent`, optional `history` | Lead payload |
| `update_lead` | Update a lead | `leadId` plus any lead update fields | Lead payload |
| `delete_lead` | Delete a lead | `leadId` | `{ success: true }` |
| `get_all_tradies` | Return the full tradie list | No inputs | Tradie array |
| `get_tradie_coordination_dashboard` | Return the tradie coordination dashboard | `page`, `limit`, `search`, `projectId`, `tradeType`, `status`, `tab`, `sortBy`, `sortOrder` | Dashboard payload |
| `create_tradie_schedule` | Create a tradie schedule | `tradieId`, `projectId`, optional `milestoneId`, `scheduledDate`, optional `durationDays` | Schedule payload |
| `update_tradie_schedule` | Update schedule status | `scheduleId`, `status` | Schedule payload plus `requiresReplacement` |
| `add_material` | Add material to a project | `projectId`, `materialData` with `name`, `category`, `specifications`, `quantity`, `unitCost`, `totalCost` | Material payload |
| `address_council_lookup` | Lookup council/address suggestions | `query`, optional `limit` | Address suggestion payload |
| `upload_file` | Upload a file to Blob and persist a file record | `file`, `projectId`, optional `milestoneId` | `{ fileId }` |

## Input Notes By Tool Group

### Lookup tools

`get_customer`, `get_site_managers`, `get_projects`, `get_project_lookup`, `get_tradies`, and `get_tradie_coordination_dashboard` all accept query-style inputs. These are the same paginated search shapes used by the app routes.

- Page numbers default to the first page when omitted.
- Limits are capped by the validator.
- Search fields are trimmed before use.

### Project tools

`create_project`, `create_project_update`, `create_variation`, `update_variation_status`, `get_project`, `get_milestones`, `create_milestone`, `add_milestone_photos`, and `update_milestone` are project-scoped.

- `create_project` uses the same validator as the project creation route.
- `create_project_update` resolves the current Clerk user from the auth context before writing, so the tool only works when the MCP client is authenticated.
- `create_variation` and `update_variation_status` both operate on a single project and variation.
- `add_milestone_photos` requires a non-empty list of file IDs.
- `update_milestone` accepts status/date/spend updates validated by Zod.

### Lead tools

The lead tools accept the same shapes as the lead API routes.

- `create_lead` accepts the lead creation schema.
- `update_lead` requires `leadId` plus the update payload.
- `delete_lead` only needs `leadId`.

### Tradie tools

`create_tradie_schedule` and `update_tradie_schedule` use the tradie schedule validators from [utils/validators/tradies.ts](../utils/validators/tradies.ts).

- `create_tradie_schedule` requires the tradie, project, and schedule date.
- `update_tradie_schedule` accepts a schedule ID and the new status.
- `get_tradie_coordination_dashboard` returns the same aggregation shape used by the coordination UI.

### File and address tools

`upload_file` expects a real `File` object and can only be used by MCP clients that support binary file transport.

`address_council_lookup` is a thin client around the address lookup HTTP endpoint. It accepts a free-text address query and an optional result limit.

## Response Shape

Every tool returns MCP structured content plus a plain-text mirror of the same payload.

That means a tool response looks like this in practice:

```json
{
  "structuredContent": { "...": "..." },
  "content": [
    {
      "type": "text",
      "text": "{\"...\":\"...\"}"
    }
  ]
}
```

This dual return shape makes the tools usable by clients that prefer structured JSON while still remaining readable in clients that only show text output.

### Client capabilities to verify

Before you rely on a client, verify that it can do the following:

- call streamable HTTP or HTTP-based MCP endpoints
- attach bearer tokens to requests
- handle JSON tool schemas
- send `File` objects if you need `upload_file`
- surface tool lists and tool errors clearly enough for debugging

## Practical Usage Examples

- Use `get_projects` to populate a project picker.
- Use `get_project` when you need the full project detail graph.
- Use `create_project_update` to post a site note and refresh the project state.
- Use `get_tradie_coordination_dashboard` to power scheduling or coordination dashboards.
- Use `upload_file` first, then pass the returned `fileId` into `add_milestone_photos`.
- Use `address_council_lookup` when you need address normalization or council suggestion data before creating a project.

## Notes And Constraints

- The current implementation is tightly coupled to Clerk auth.
- Tool inputs are validated with Zod before the data helpers run.
- Read tools use cached helpers where possible.
- Write tools usually return refreshed domain payloads so clients do not need to re-query immediately.
- `upload_file` is the most client-dependent tool because it requires binary file support.
- Claude Code is the easiest direct client for the current remote HTTP server.
- Claude Desktop needs a local bridge or a local MCP server shape to consume this remote endpoint cleanly.

If you want, I can also add a short `README` pointer or a sample configuration snippet for a specific client such as Claude Desktop, Cursor, or Continue.
