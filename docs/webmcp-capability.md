# WebMCP Capability

This document describes how the app exposes its tools to an AI agent running **inside the user's browser**, using the W3C [WebMCP](https://webmachinelearning.github.io/webmcp/) API.

It is the browser counterpart to [mcp-capability.md](./mcp-capability.md), which covers the server-side MCP endpoint. The two share one tool registry and cannot drift apart.

## What WebMCP is

A page registers tools on `document.modelContext`. An agent running in that browser discovers them with `getTools()` and calls them with `executeTool()`. Same vocabulary as MCP — name, description, JSON Schema inputs, `content` results — but browser-native: secure-context only, same-origin by default, gated by the `tools` permissions policy, and scoped to the document's lifetime via `AbortSignal`.

The difference that matters here is authentication. The MCP endpoint at `/api/mcp` requires an OAuth flow and a bearer token. A browser tool runs inside the user's existing session, so there is nothing to configure: they sign in to the app as usual and the agent can act as them.

## Where it works

| Consumer | Status |
| --- | --- |
| **ChatGPT Desktop built-in browser** | Supported. No origin-trial token, no extension, no polyfill. This is what the app targets. |
| Chrome 149–156 / Edge 150 | Origin trial. Set `NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN` (registered at chrome.com/origintrials) and `app/layout.tsx` emits the meta tag. |
| Brave | Experimental, in Leo. |
| Firefox / Safari | Standards positions filed, no implementation. |

Two constraints from ChatGPT's own [Site tools docs](https://learn.chatgpt.com/docs/webmcp) matter for a B2B deployment: site tools are **unavailable in ChatGPT Enterprise and Edu workspaces**, and require GPT-5.6 Sol or Terra (Luna has WebMCP disabled).

Everywhere else `document.modelContext` is simply absent, every registration is skipped, and the app behaves exactly as it did before.

## Architecture

```
lib/tools/
  types.ts             ToolDescriptor, AppRole, annotations
  manifest.ts          25 tool descriptors — name, description, Zod schemas,
                       annotations, requiredRole, surface. Client-safe.
  json-schema.ts       Zod -> JSON Schema for the browser
  result.ts            toToolResult / toToolError, shared result shape
  authz.ts             the role gate
  operating-guide.ts   the agent guide, shared by both transports
  handlers.server.ts   name -> handler, calling lib/data/*
  registry.server.ts   manifest + handlers, joined; throws on drift
```

Two server entry points consume the registry:

- `app/(mcp)/api/mcp/route.ts` — the MCP server. OAuth via Clerk, unchanged.
- `app/api/webmcp/[tool]/route.ts` — the browser bridge. Clerk **session cookie**.

And the browser side:

- `components/webmcp/webmcp-provider.tsx` — registers the bridged tools plus the UI tools. Mounted once, in `components/common/app-shell.tsx`.
- `components/webmcp/bridge.ts` — posts a tool call to the bridge route.
- `components/webmcp/ui-tools.ts` — the browser-only tools.
- `hooks/use-webmcp-tool.ts` — registers one tool for as long as a screen is mounted.

```
ChatGPT Desktop browser
   |  document.modelContext.executeTool("update_lead", {...})
   v
webmcp-provider  --POST /api/webmcp/update_lead-->  proxy.ts (Clerk session)
                                                        |
                                     registry.server.ts <+
                                                |
                                          lib/data/leads.ts
                                                ^
   Claude Code --OAuth bearer--> /api/mcp ------+
```

## Tools

### Bridged tools

Every tool in [mcp-capability.md](./mcp-capability.md) is registered in the browser too, with one exception:

- **`upload_file`** is `surface: "server"`. It takes the file as base64 in its arguments, which a browser agent has no way to produce.

Names, descriptions and input schemas are identical across both transports — they come from the same manifest entry.

### Browser-only tools

These have no server counterpart. They are the reason to expose tools through the page at all.

| Tool | Purpose |
| --- | --- |
| `get_current_view` | The route the user is on, and the project or tradie whose detail page is open. Call it first when the user says "this project" or "here". |
| `navigate_to` | Opens a section, optionally a specific record. Destination is checked against the real sidebar; arbitrary URLs are refused. |
| `get_operating_guide` | Returns the operating guide. WebMCP has no prompts primitive, so without this tool a browser agent would never see the guidance the MCP server ships as `mcp_royal_construction`. |
| `leads_set_search` | Types into the search box on the leads screen, so the visible list narrows. Registered only while that screen is mounted. |
| `leads_filter_by_stage` | Filters the visible leads list by stage. Registered only while that screen is mounted. |

The last two are registered through `useWebMcpTool` in `components/leads/leads.tsx` and are the worked example for adding more. Contextual registration is deliberate: agent accuracy falls off as the tool list grows, so a screen offers its tools while it is on screen and withdraws them when the user navigates away.

## Authentication and authorization

- **Authentication** is the Clerk session cookie. `proxy.ts` answers any unauthenticated `/api/*` request with a `401`, and `/api/webmcp` is deliberately absent from its `isPublicRoute` list.
- **Authorization** is the `requiredRole` field on each manifest entry, enforced in the bridge route via `assertRole`. `delete_lead` and `update_variation_status` require `ADMIN`.

Both checks are server-side on purpose. The provider also filters the list it registers by role, but that is only so the agent does not waste turns on calls that will 403 — a page-registered tool runs with the full ambient session, so the decision that counts cannot live in the browser.

The bridge additionally applies a per-user ceiling of 60 calls/minute. It is instance-local: it bounds a runaway agent loop, which is the case that actually happens, and is not a distributed quota.

## Annotations

Each tool carries WebMCP `annotations`:

- `readOnlyHint` — `true` for `get_*` and `*_lookup`, `false` for everything else. A unit test asserts this follows the verb, because a write mislabelled read-only is the mistake that costs data.
- `untrustedContentHint` — `true` on `get_leads`, `get_projects`, `get_project`, `get_milestones` and `get_tradie_coordination_dashboard`. Those payloads carry lead notes and Graph-ingested email bodies: text written by people outside the business, which the agent should treat as data and not as instructions.

Both are **hints**. Nothing in the spec enforces them, and ChatGPT's confirmation policy for consequential actions is theirs, not ours. The role gate is the only boundary that is actually enforced.

## Result shape

Identical to the MCP server — `structuredContent` plus a `content` text mirror, built by the shared `toToolResult`. Failures go through `toToolError`, which always sets `isError: true`; without it a tool that declares an `outputSchema` fails SDK output validation and the real message never reaches the agent.

WebMCP has no `outputSchema` in the current IDL, so the bridge route validates the payload against the manifest's output schema itself and logs a mismatch. The browser path keeps the guarantee the MCP path has.

## Cache and refresh

Mutations revalidate their own cache tags inside `lib/data/*` (`milestones.ts`, `tradieSchedules.ts`, `projectsWrite.ts` and friends), so the bridge adds no tagging of its own. What it does add is a `mutated` flag on the response for any non-read-only tool; the provider sees it and calls `router.refresh()`.

That last step is not cosmetic. With `cacheComponents: true` a successful write that leaves the page unchanged reads to the user as a failed one.

## Testing

- `tests/webmcp/manifest.test.ts` — names, uniqueness, JSON Schema conversion of all 25 input schemas, the `readOnlyHint` rule, the admin gates, and the role logic. Fast.
- `tests/webmcp/registry-parity.test.ts` — every manifest entry has a handler and vice versa. Slow (boots the data layer); `registry.server.ts` enforces the same invariant at import time.

There is no way to drive ChatGPT Desktop's agent from a test. For manual verification, `/webmcp-inspector` (development only, under the authenticated shell so it sees the real registration) lists `getTools()` and runs any tool through `executeTool()` with arguments you type.

## Known limits

- The spec is moving. `navigator.modelContext` became `document.modelContext` in July 2026; output schemas, streaming, progress reporting and consequential-action hints are still open. Every spec touchpoint is confined to `types/webmcp.d.ts`, `components/webmcp/webmcp-provider.tsx` and `hooks/use-webmcp-tool.ts`.
- No mainstream agent besides ChatGPT Desktop consumes page tools yet.
- The app ingests untrusted external content (inbound email via `lib/graph/*`, lead notes, OCR'd attachments). An agent that reads a lead page while holding write tools is a prompt-injection path. `untrustedContentHint` is advisory; treat the write surface on lead and email screens as the area needing review first.
- `pick_and_upload_file`, `prefill_form` and per-screen `apply_filter` beyond leads are not implemented. `useWebMcpTool` is the hook to add them with; the leads screen is the pattern to copy.
