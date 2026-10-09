# The Eve MCP endpoint

Royal Construction publishes one MCP server: the Eve operations agent, at

```
https://<host>/eve/v1/mcp
```

It replaces the hand-written MCP route that used to live at `/api/mcp`
(issue #303). That route is gone, along with its OAuth metadata routes at
`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`.

The difference is not cosmetic. The old route carried its own tool registry,
its own prompt and its own authentication path, none of which the rest of the
system knew about, so a rule enforced on screen was not necessarily enforced
there. This endpoint has no registry of its own. It hands your message to the
same orchestrator the staff use in the `/agent` workspace, which routes it to
the same specialists, which call the same `lib/domain` commands. One set of
rules, one audit trail.

## Connecting

For the step-by-step version — Claude Code, a hosted client, or a client you
are writing — see [Connect an MCP client](./connect-an-mcp-client.md). This
section is the contract it implements.

The endpoint speaks Streamable HTTP. It serves MCP `2026-07-28` and keeps
stateless `2025-11-25` compatibility; there is no transport session to hold
open.

Authentication is a **Clerk OAuth access token**, and only that. There is no
API key and no shared secret.

1. Your client gets a `401` with a `WWW-Authenticate: Bearer` challenge
   carrying `resource_metadata`.
2. It reads that URL for the protected-resource metadata, which names Clerk as
   the authorization server.
3. It registers itself with Clerk through dynamic client registration
   ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)). Clerk supports it, so
   a hosted client such as Claude, ChatGPT or Grok does this by itself the
   first time somebody connects.
4. The person signs in to Clerk, consents to the `profile` and `email` scopes,
   and the client gets a token.

The person signing in must already have a Royal Construction account. A valid
Clerk token for an account with no application user gets
`403 agent_access_denied`, and there is no self-service path past it: somebody
has to create the account.

If the operations agent is switched off for the environment
(`EVE_OPERATIONS_AGENT_ENABLED`), every request gets `403 agent_disabled`.

### A note on the metadata URL

RFC 9728 says the metadata for `https://host/eve/v1/mcp` lives at
`https://host/.well-known/oauth-protected-resource/eve/v1/mcp`. Here it is
served at

```
https://<host>/eve/v1/mcp/.well-known/oauth-protected-resource
```

because only `/eve/v1/*` is routed to the agent. That is the URL the `401`
challenge advertises, so a client that follows the challenge never notices.
The canonical path redirects (308) to it for a client that goes straight
there.

## The four tools

| Tool | Input | What it does |
| --- | --- | --- |
| `agent_start` | `{ message, outputSchema? }` | Starts durable work, returns an invocation ID immediately |
| `agent_get` | `{ invocationId }` | Reads the invocation's current state |
| `agent_update` | `{ invocationId, responses }` | Answers a complete pending input batch |
| `agent_cancel` | `{ invocationId }` | Requests cooperative cancellation |

You send natural language to `agent_start`, then poll `agent_get` until the
invocation reaches a terminal state. While the status is `working`, wait at
least the returned `pollAfterMs` before polling again.

The `agent_start` tool description opens with what this agent covers, what
needs approval and what it cannot do (it is the root agent's `description` in
`agent/agent.ts`), so a connecting model knows what to ask for without a
separate briefing.

Specialist work happens **inside** the invocation. The orchestrator delegates
through a blocking workflow tool, so the invocation stays `working` while a
specialist runs — including while it waits on an owner approval, which surfaces
as `input_required` — and `completed` carries the finished answer. Before this,
specialists ran as background tasks: an invocation settled as `completed` with
"I'll share the results once the task completes" and eve terminated the
specialist, so the answer never arrived. If you see that wording in a
`completed` result, the deployment predates the fix.

### Statuses

- `working` — keep polling.
- `input_required` — the agent needs an answer. Present `inputRequests` to the
  person and send the **complete** batch back through `agent_update`. This is
  how an approval-gated write asks for its approval, and how the agent asks
  which of two matching records you meant.
- `authorization_required` — present the returned sign-in URL or user code.
  The callback resumes the invocation; keep polling.
- `completed` — read the optional `result`.
- `failed` — read the structured `error`. A domain refusal arrives here, named,
  rather than as a generic server error.
- `cancelled` — cancellation reached a terminal state.

A tool result with `isError: true` is a rejected **call**, so fix the call. A
`failed` status is a call that succeeded and a **task** that failed, so report
it. Rejected calls carry `structuredContent.error` with a stable `code`
(`invalid_input`, `not_found`, `conflict`, `internal`) and `retryable`.

`not_found` also covers an invocation that belongs to someone else. Ownership
is re-checked on every operation against the Clerk principal, so holding an
invocation ID is not enough to read, answer or cancel it.

### `agent_start` is not idempotent

**If the response to `agent_start` is lost, do not retry it.** You have no
invocation ID to check, and a second call starts a second task: a second email
to a client, a second envelope, a second booking. Ask the person before
starting again.

`agent_update` is safe to repeat. Re-sending answers Eve already accepted
returns the current state; sending *different* answers for an already-answered
batch is a `conflict`.

`agent_cancel` is cooperative and races with completion. Poll `agent_get`
until the status is terminal — `cancelled`, `completed` **or** `failed` — not
specifically `cancelled`.

### Limits

The whole request body is capped at 1 MiB, `message` at 64 KiB, each input
response `text` at 16 KiB (UTF-8 bytes, not characters), and one
`agent_update` at 64 responses. An optional `outputSchema` is capped at 64 KiB,
32 levels and 2,048 nodes, and external `$ref` values are rejected.

## What the agent can do

The agent routes to whichever specialist owns the request. As of this change
the supported areas are:

- **Leads** — look one up, read its history and linked records, list, create,
  complete and reopen lead tasks.
- **Offers** — search, read details, activity, signing status and revisions,
  draft highlights, save contract particulars, log a change request, create a
  revision, transition status, recall an envelope.
- **Projects** — search, read a project with its milestones, schedules, site
  updates, files and customer, create and update milestones, read and update
  project requirements, list assignable site managers and reassign a
  project's site manager (administrators only).
- **Compliance** — start an engagement, read it, set a document required,
  resolve a document, prepare and send outreach and follow-ups.
- **Tradies** — search and read the directory, create and update a tradie,
  rate one, list schedules, create, reschedule and transition a schedule,
  request a price change, a removal or a schedule deletion, report an incident.
- **Admin**, for administrators only — team list and roles, invitations, the
  approval queue, admin offer content, the Xero connection, and the build
  sequence template used by new projects. Read its activities, stages, parent
  links, estimated calendar days, tradie category dependencies and related
  cost-schedule tasks. Add, update, move or remove activities with owner
  approval. Edits preserve unrelated activities, reject stale revisions and
  leave existing projects' milestones unchanged.

Writes that are persistent, irreversible or visible to a client go through the
approval flow, which reaches you as an `input_required` turn. They are audited
under the signed-in user and carry a durable idempotency key.

## What the retired route did that this does not

The old registry exposed operations the current specialists deliberately do
not. **This is not a one-for-one replacement**, and it is worth knowing which
side of the line a capability is on before building against it.

| Retired tool | Status here |
| --- | --- |
| `get_projects`, `get_project_lookup`, `get_project` | Covered by `search_projects` and `get_project` |
| `get_milestones` | Covered: `get_project` returns milestones |
| `create_milestone`, `update_milestone` | Covered |
| `get_leads` | Covered by `search_leads` and `get_lead` |
| `get_tradies`, `get_all_tradies` | Covered by `search_tradies` and `get_tradie` |
| `get_tradie_coordination_dashboard` | Covered by `list_schedules` |
| `create_tradie_schedule` | Covered by `create_schedule`, which has the duplicate-booking and milestone-ownership checks the old one lacked |
| `update_tradie_schedule` | Covered by `transition_schedule` |
| `create_variation`, `update_variation_status` | **Retired.** Variation rules are not implemented, and the agent says so rather than guessing |
| `create_lead`, `update_lead`, `delete_lead` | **Not available.** Lead writes have no domain command yet |
| `create_project_update` | **Not available** |
| `add_material` | **Not available** |
| `upload_file`, `add_milestone_photos` | **Not available.** The agent reads and links existing files; it takes no uploads over MCP |
| `address_council_lookup` | **Not available** |
| `get_site_managers` | Covered by `list_site_managers`; `assign_site_manager` reassigns a project through the same command as the project header |
| `get_customer` | **Not available** as a standalone lookup. Customer data comes back with the project |
| `create_project` | Never existed. The old prompt documented it, but no such tool was ever registered |

Anything on the "not available" list is a business decision, not an oversight.
If one of them is wanted it gets a `lib/domain` command that the app and the
agent both call, tested once — not a second implementation behind a second
route, which is the state this change removes.

## Configuration

| Variable | Effect |
| --- | --- |
| `EVE_OPERATIONS_AGENT_ENABLED` | `"true"` enables the endpoint. Anything else refuses every request with `agent_disabled` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | The Clerk instance. The advertised authorization server is derived from it, so it cannot drift from the one the app signs in against |
| `EVE_MCP_ISSUER` | Overrides that derived issuer |
| `NEXT_PUBLIC_APP_URL` | The app's public origin. The advertised resource identifier is this plus `/eve/v1/mcp` |
| `EVE_MCP_RESOURCE` | Overrides that, for a gateway that serves MCP on a different origin or path. Use an HTTPS URL with no credentials, query, or fragment; HTTP is allowed only for loopback development URLs. An invalid override logs a warning and falls back to `NEXT_PUBLIC_APP_URL`. |

The resource identifier is taken from configuration rather than from the
request on purpose. `withEve` reaches the agent by proxying to a separate
server, so the request arrives carrying an internal origin; left to derive it,
Eve would advertise `http://127.0.0.1:<port>/eve/v1/mcp` as the resource the
whole OAuth exchange is keyed on. If `NEXT_PUBLIC_APP_URL` is wrong for an
environment, the sign-in flow is what breaks.

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (or `EVE_MCP_ISSUER`) has to be present
when `eve build` runs, not just at runtime: whether the OAuth discovery routes
exist at all is decided when the route table is compiled. A build without one
logs a warning and publishes the endpoint without discovery, which leaves
clients with a `401` and nowhere to sign in.
