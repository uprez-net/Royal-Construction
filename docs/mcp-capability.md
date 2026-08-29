# MCP Capability

This document describes the current MCP server implementation in this repository, the tools it exposes, the inputs each tool accepts, and how a client can connect to it.

The transport lives in [app/(mcp)/api/mcp/route.ts](../app/(mcp)/api/mcp/route.ts): built with `mcp-handler`, wrapped in Clerk-based auth, registering tools through `server.registerTool(...)`.

The **tools themselves** live in [lib/tools/](../lib/tools/) — `manifest.ts` for the descriptors and `handlers.server.ts` for the implementations, joined by `registry.server.ts`. That registry is shared with the browser-side WebMCP surface, so the two transports expose the same tools by construction. See [webmcp-capability.md](./webmcp-capability.md).

## How It Works

At a high level, the MCP server follows this flow:

1. A client connects to the MCP endpoint.
2. The request passes through the `withMcpAuth(...)` wrapper.
3. Clerk verifies the bearer token and attaches auth context to the request.
4. `createMcpHandler(...)` creates the MCP server instance and iterates `TOOL_REGISTRY`.
5. Each tool validates its input with Zod schemas from `utils/validators/*`.
6. Tools declaring a `requiredRole` are checked against the caller's role before dispatch.
7. The tool handler calls the matching `lib/data/*` helper or a direct integration helper.
8. The result is returned as structured MCP content and also serialized as text for client compatibility.

Most read tools call cached helpers such as `getCachedProjects(...)`, `getCachedProjectById(...)`, `getCachedTradies(...)`, and `getCachedTradieCoordinationDashboard(...)`. Write tools call the underlying mutation helpers directly and then return the newly created or refreshed payload.

Two design choices matter when you use the server:

- the tool schemas are intentionally close to the route validators, so the MCP contract mirrors the HTTP API
- write tools usually return a full refreshed entity rather than a partial success message, which makes them easier to use from agents that need the latest state immediately

## Authentication

The MCP server is protected.

- Requests must present a valid Clerk bearer token.
- The auth wrapper uses `withMcpAuth(...)` and the request must satisfy the required scope configured by the server.
- No tool on this surface mutates data any more, so the role gate the manifest carries (`requiredRole`, enforced by `assertRole` before the handler runs) currently has nothing to guard. It stays because the next write tool to arrive here should be gated by declaring a role, not by remembering to write a check.

In practice, MCP clients need to support bearer-token or OAuth-style auth. If a client cannot attach an access token, it will not be able to call the protected tools.

## Available Tools

The table below reflects the current tool registry in [app/api/mcp/route.ts](../app/api/mcp/route.ts).

**This surface is now read-only.** Every write moved to the screen that owns it, reachable over
WebMCP only - see [webmcp-capability.md](./webmcp-capability.md). Two rounds of retirement got here.
First the twelve write tools whose browser flows had moved on from the server actions these handlers
wrapped: project creation now runs through `createProjectWithLead` off an extracted tender and
contract, milestone updates go through the milestone `/updates` route, lead writes go through
`lib/leads/leads-service`, and file upload needs a file the agent does not have. Then `add_material`
and the two variation tools, for the same reason.

Two reads left as well. `get_projects` returned whole project rows with stats, which is too large a
payload to carry in a tool result when `get_project_lookup` answers the same question in three
fields; `get_all_tradies` returned the unfiltered directory, which `get_tradies` already does with a
filter. Point callers at the replacements.

| Tool | Purpose | Inputs | Output |
| --- | --- | --- | --- |
| `get_customer` | Search customers for dropdowns and project creation | `page`, `limit`, `q`, `search` | Paginated customer list |
| `get_site_managers` | Search site managers for assignment | `page`, `limit`, `q`, `search` | Paginated site manager list |
| `get_tradies` | Search tradies for lookup and scheduling | `search`, `q`, `limit`, `page` | Tradie list |
| `get_project_lookup` | Lookup projects for autocomplete | `page`, `limit`, `q` | Paginated project lookup list |
| `get_project` | Fetch a full project detail payload | `projectId` | Project detail payload |
| `get_milestones` | List milestones for a project | `projectId` | Milestone array |
| `get_leads` | List all leads | `q`, `status`, `filterTiming`, `page`, `limit` | Lead array |
| `address_council_lookup` | Lookup council/address suggestions | `query`, optional `limit` | Address suggestion payload |

## Input Notes By Tool Group

### Lookup tools

`get_customer`, `get_site_managers`, `get_project_lookup` and `get_tradies` all accept query-style inputs. These are the same paginated search shapes used by the app routes.

- Page numbers default to the first page when omitted.
- Limits are capped by the validator.
- Search fields are trimmed before use.

### Project tools

`get_project` and `get_milestones` are project-scoped and take a `projectId`.

- `get_project_lookup` requires `mode: "lookup"` alongside its query fields. Omitting it is a validation error, not an empty result.
- Creating projects, milestones, site updates, variations and materials is not available here; those are WebMCP screen tools.

### Lead tools

`get_leads` accepts the same query shape as the lead list route: `q`, `status`, `filterTiming`, `page`, `limit`. An unknown stage label is rejected rather than silently widening the query to every lead.

Lead writes are not on this surface. They are WebMCP tools on the leads screen, calling the same `lib/leads/leads-service` functions the modals call.

### Tradie tools

`get_tradies` is the read-only lookup for resolving a tradie ID. It requires a query - there is no unfiltered listing.

Scheduling is not on this surface. It is a WebMCP screen tool on the project's tradie tab, and the coordination dashboard is a screen aggregate rather than a tool.

### File and address tools

`upload_file` has been removed. It took the file as base64 in its arguments, which no agent can produce for a document it has never seen. The browser equivalents - `upload_lead_files` and `upload_project_files` - open the real file picker instead.

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
- surface tool lists and tool errors clearly enough for debugging

## Practical Usage Examples

- Use `get_project_lookup` to populate a project picker.
- Use `get_project` when you need the full project detail graph.
- Use `address_council_lookup` when you need address normalization or council suggestion data before creating a project.

## Notes And Constraints

- The current implementation is tightly coupled to Clerk auth.
- Tool inputs are validated with Zod before the data helpers run.
- Read tools use cached helpers where possible.
- Claude Code is the easiest direct client for the current remote HTTP server.
- Claude Desktop needs a local bridge or a local MCP server shape to consume this remote endpoint cleanly.

For the browser-side surface — same tools, no OAuth, plus tools that move the UI — see [webmcp-capability.md](./webmcp-capability.md).
