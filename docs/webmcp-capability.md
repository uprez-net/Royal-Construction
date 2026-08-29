# WebMCP Capability

This document describes how the app exposes its tools to an AI agent running **inside the user's browser**, using the W3C [WebMCP](https://webmachinelearning.github.io/webmcp/) API.

It is the browser counterpart to [mcp-capability.md](./mcp-capability.md), which covers the server-side MCP endpoint.

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

## Two kinds of tool

This is the thing to understand before reading anything else.

**Shared tools** live in `lib/tools/manifest.ts`. They are the same operation on both transports, so one descriptor and one handler serve the MCP server and the browser bridge alike. They are registered globally and available on every authenticated page.

**Screen tools** are registered by the React component that owns the feature, and exist only while that screen is mounted. They call the same Redux thunks and service functions the UI calls, so an agent write goes through the same code path as a human click — same validation, same optimistic update, same visible result.

The split is not stylistic. Twelve write tools started life on the MCP server wrapping `lib/data/*` directly, and the browser moved on from underneath them:

| Tool | Why it could not stay |
| --- | --- |
| `create_project` | Browser now calls `createProjectWithLead`, needing an uploaded tender + contract and the `extraction` payload the Workflow DevKit run produces from them. |
| `create_project_update` | Posted to `/api/projects/[id]/updates` with `photoUrls`; the handler called `createProjectUpdate` directly and the screen never saw the write. **Since removed outright** — posting an update is something the user should watch happen. |
| `create_milestone` | `milestoneCreationSchema` gained a required `projectStage`. |
| `update_milestone` | Goes through the milestone `/updates` route, and the tool's schema had dropped `milestoneUpdateSchema`'s conditional rules by `.extend()`-ing its shape. |
| `add_milestone_photos` | Only meaningful after an upload the agent cannot perform. |
| `create_lead` / `update_lead` / `delete_lead` | Browser goes through `lib/leads/leads-service`, which handles the duplicate-lead 409 and keeps the visible list in step. |
| `create_tradie_schedule` | Belongs to an open project; the thunk feeds the store. |
| `update_tradie_schedule` | Advertised `quote` and `quoteUnit`, which `PATCH /api/tradie-schedules/[id]` parses and then discards — only `status` is forwarded. **Since removed outright** — it is not part of the current coordination flow. |
| `upload_file` | Took the file as base64 in its arguments. An agent has no file content. |
| `get_tradie_coordination_dashboard` | **Removed outright.** A screen aggregate, not an operation. |

A second round then took five more, for a different reason: a globally-registered tool has to earn its place in every conversation, and these did not.

| Tool | Why it left |
| --- | --- |
| `get_projects` | Whole project rows with stats. `get_project_lookup` answers the same question — resolve a name to an id — in three fields. |
| `get_all_tradies` | The unfiltered directory, and slow. `get_tradies` is the same read with a filter. |
| `add_material` | Server-side write against an implementation the UI has moved past. |
| `create_variation`, `update_variation_status` | Not needed yet; they return to the project detail page later. |

`tests/webmcp/manifest.test.ts` asserts none of these reappear in the shared manifest, and that it holds no write tools at all.

## Architecture

```
lib/tools/
  types.ts             ToolDescriptor, AppRole, annotations
  manifest.ts          8 shared descriptors, all reads. Client-safe.
  json-schema.ts       the browser-facing descriptor list
  zod-to-json-schema.ts  Zod -> JSON Schema, usable without the manifest
  result.ts            toToolResult / toToolError (server side)
  authz.ts             the role gate
  operating-guide.ts   the agent guide, shared by both transports
  handlers.server.ts   name -> handler, calling lib/data/*
  registry.server.ts   manifest + handlers, joined; throws on drift

components/webmcp/
  webmcp-provider.tsx  registers the shared tools + the global UI tools
  role-context.tsx     the role a screen tool gates its registration on
  bridge.ts            posts a shared-tool call to the bridge route
  ui-tools.ts          navigate_to, get_current_view, get_operating_guide
  tool-result.ts       webMcpText / webMcpJson / webMcpError (client side)
  file-upload.ts       file picker + client blob upload
  webmcp-inspector.tsx dev harness

hooks/use-webmcp-tool.ts   useWebMcpTools / useWebMcpTool
types/webmcp.d.ts          pulls in the official webmcp-types definitions
```

```
ChatGPT Desktop browser
   |
   |-- shared tool ----> /api/webmcp/[tool] --> registry.server.ts --> lib/data/*
   |                     (Clerk session cookie)
   |
   `-- screen tool ----> Redux thunk / leads-service --> /api/... --> lib/data/*
                         (the same path a click takes)

   Claude Code --OAuth bearer--> /api/mcp --> registry.server.ts --> lib/data/*
```

## Types

Type definitions come from [`webmcp-types`](https://www.npmjs.com/package/webmcp-types), published by the W3C Web Machine Learning CG alongside the spec. It is a `devDependency` and contributes the global `WebMCP.*` namespace and the `Document.modelContext` property.

Because it sits outside DefinitelyTyped, TypeScript does not pick it up automatically. `types/webmcp.d.ts` pulls it in with `/// <reference types="webmcp-types" />` — deliberately not the `"types": ["webmcp-types"]` tsconfig option the README suggests first, since that would switch off automatic inclusion of every other `@types/*` package this project depends on.

That same file carries one augmentation: `executeTool`, which is in the spec IDL but not in `webmcp-types` 0.1.5 (the package covers only the registration half of the API). `/webmcp-inspector` needs it. Delete that block when the package catches up.

## Tool inventory

### Always available

The 8 shared tools from [mcp-capability.md](./mcp-capability.md), plus three UI tools:

| Tool | Purpose |
| --- | --- |
| `get_current_view` | The route the user is on, and the project or tradie whose detail page is open. Call it first when the user says "this project" or "here". |
| `navigate_to` | Opens a section, optionally a specific record. Checked against the real sidebar; arbitrary URLs are refused. |
| `get_operating_guide` | Returns the operating guide. WebMCP has no prompts primitive, so without this a browser agent would never see the guidance the MCP server ships as `mcp_royal_construction`. |

### Leads screen — `components/leads/leads.tsx`

`leads_filter_by_stage`, `create_lead`, `update_lead`, `delete_lead` (admin only).

`leads_set_search` was removed: `get_leads` answers the same question faster and without depending on browser state.

Input schemas are converted from `createLeadSchema` and `updateLeadSchema` — the same validators `POST /api/leads` and `PATCH /api/leads/[leadId]` use, so the tool and the form cannot disagree about a valid payload. `history` is omitted from `update_lead`: it is the lead's audit trail, and an agent authoring entries there would be forging a record.

Results feed back through `useLeadsData`'s own setters (`prependLead`, `updateLeadInList`, `removeLeadFromList`), so the visible list updates the way it does for a human edit.

### Lead detail — `components/leads/detail/lead-detail-screen.tsx`

`upload_lead_files` — opens the file picker, uploads to `leads/<id>/…`, and appends to the Documents tab.

### Projects list — `components/projects/projects-client.tsx`

`start_project_creation` — opens the new-project wizard, optionally with a lead preselected. It creates nothing: the wizard still needs the user to upload a tender and contract and review what the extraction produced.

### Project detail — `components/projects/project-detail-screen.tsx`

`create_milestone`, `update_milestone`, `add_milestone_photos`, `upload_project_files`, `create_tradie_schedule`.

None of these take a `projectId`. They act on the project that is open, so an agent cannot quietly edit a different one. `update_milestone` validates against the full refined `milestoneUpdateSchema`, which is what stops a half-filled `DONE` landing as a milestone marked complete with no spend against it.

## File upload

`components/webmcp/file-upload.ts` replaces the retired `upload_file`. `pickFiles()` opens a real `<input type="file">` and infers a cancel from the window regaining focus with no `change` event — there is no cancel event to listen for, and an agent calling this is by definition not a click, so a browser that refuses to open the dialog lands in the same path. `uploadFiles()` then runs the same `@vercel/blob/client` upload the UI runs, against `/api/upload`, whose `onUploadCompleted` writes the `File` row. A resolved upload is already persisted.

## Authentication and authorization

- **Authentication** is the Clerk session cookie. `proxy.ts` answers any unauthenticated `/api/*` request with a `401`, and `/api/webmcp` is deliberately absent from its `isPublicRoute` list. Screen tools inherit the same session, since they go through the app's own routes.
- **Authorization** is the `requiredRole` field, declared on a shared descriptor or on a screen tool's config. On the bridge it is enforced by `assertRole` before the handler runs; on a screen tool `useWebMcpTools` simply leaves the tool out of the registration, so the agent never sees it. `delete_lead` requires `ADMIN`.

  Be clear about the difference. The bridge check is enforcement — the tool cannot run. The screen-tool check is a menu filter: it stops the agent wasting turns on a call that would fail, but a screen tool calls the app's own routes, and most of those do not check role. Anything that genuinely must not happen has to be refused by the route.

Both checks are server-side on purpose. The provider also filters the list it registers by role, but only so the agent does not waste turns on calls that will 403 — a page-registered tool runs with the full ambient session, so the decision that counts cannot live in the browser.

The bridge applies a per-user ceiling of 60 calls/minute. It is instance-local: it bounds a runaway agent loop, which is the case that actually happens, and is not a distributed quota. Screen tools are not rate limited; they are bounded by the routes they call.

## Annotations

- `readOnlyHint` — `true` for `get_*` and `*_lookup`, `false` for everything else. A unit test asserts this follows the verb on the shared manifest, because a write mislabelled read-only is the mistake that costs data.
- `untrustedContentHint` — `true` on `get_leads`, `get_project` and `get_milestones`. Those payloads carry lead notes and Graph-ingested email bodies: text written by people outside the business, which the agent should treat as data and not as instructions.

Both are **hints**. Nothing in the spec enforces them, and ChatGPT's confirmation policy for consequential actions is theirs, not ours. The role gate is the only boundary that is actually enforced.

## Result shape

Shared tools return `structuredContent` plus a `content` text mirror, built by `lib/tools/result.ts`. Screen tools build the same shape client-side with `components/webmcp/tool-result.ts`, so an agent cannot tell which transport a tool used from its result.

Failures go through `toToolError` / `webMcpError`, which always set `isError: true`. Without the flag an agent reads a sentence that merely begins "Error" as data and carries on as though the write had succeeded. `tests/leads/lead-helpers.test.ts` asserts both helpers still set it.

Screen tools also flatten Zod failures with `summariseZodIssues`, which names the offending field and rule. `error.message` is a raw JSON blob — useless to a model deciding what to send next.

## Cache and refresh

Shared write tools rely on `lib/data/*` revalidating its own cache tags, and the bridge returns a `mutated` flag so the provider can call `router.refresh()`.

Screen tools need neither: they go through the store, so the tab the user is looking at re-renders.

## Testing

- `tests/webmcp/manifest.test.ts` — names, uniqueness, JSON Schema conversion, the `readOnlyHint` rule, the admin gate, the role logic, and that the twelve retired tools stay retired. Fast.
- `tests/webmcp/registry-parity.test.ts` — every manifest entry has a handler and vice versa. Slow (boots the data layer); `registry.server.ts` enforces the same invariant at import time.

There is no way to drive ChatGPT Desktop's agent from a test. For manual verification, `/webmcp-inspector` (development only, under the authenticated shell) lists `getTools()` and runs any tool through `executeTool()`. Because screen tools register on mount, the list there changes as you navigate — that is the behaviour to check.

## Known limits

- The spec is moving. `navigator.modelContext` became `document.modelContext` in July 2026; output schemas, streaming, progress reporting and consequential-action hints are still open. Tracking `webmcp-types` absorbs most of that churn; what it does not is confined to `types/webmcp.d.ts`, `components/webmcp/webmcp-provider.tsx` and `hooks/use-webmcp-tool.ts`.
- No mainstream agent besides ChatGPT Desktop consumes page tools yet.
- Screen tools are only reachable from their screen. An agent asked to update a lead from the dashboard must `navigate_to` first — the operating guide says so explicitly, but it is a real constraint, not a detail.
- The app ingests untrusted external content (inbound email via `lib/graph/*`, lead notes, OCR'd attachments). An agent that reads a lead page while holding write tools is a prompt-injection path. `untrustedContentHint` is advisory.
- Project creation, and anything that emails a customer, remain human actions. See the phase-two plan for the reasoning.
