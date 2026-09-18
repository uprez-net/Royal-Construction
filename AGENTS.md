<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Royal Construction Eve operations agent

The authenticated orchestrator in `agent/agent.ts` routes requests to the
smallest matching specialist. The lead, offer, project, tradie, and admin
specialists in `agent/subagents/` call application-owned domain services and
must preserve Clerk authentication, owner-scoped sessions, authorization,
approval, idempotency, and audit boundaries. Variation operations are
currently unavailable.

The orchestrator uses `zai/glm-5.3-flash`, low reasoning, a 1,000,000-token
context window, and per-session limits of 120,000 input tokens, 12,000 output
tokens, $1 maximum token cost, and a seven-day timeout. Dynamic specialists
use the same model and context window with separate limits of 40,000 input
tokens, 4,000 output tokens, $0.25 maximum token cost, and a 24-hour timeout.

Use the agent through the feature-flagged `/agent` workspace and its
authenticated API routes. Do not use the deprecated chatbot/MCP route for
operations.

### Agent code cannot import Next.js-only packages

`eve build` bundles authored code — everything under `agent/` plus the
application modules it imports by value — and leaves installed packages
external for Node's own ESM loader. `@clerk/nextjs`, `next/headers`,
`next/cache`, `next/server` and `next/navigation` publish extensionless
relative imports that only a bundler resolves, and `server-only` throws on
import outside a React bundler. A value import of any of them from `agent/`
fails the build. `build: { externalDependencies: [...] }` does not rescue it;
that setting makes a package more external, never bundled. `import type` edges
are erased before the bundler sees them and are safe.

Clerk authentication is preserved at the channel boundary instead, not inside
tools. `agent/channels/eve.ts` authenticates every request through
`agent/lib/channel-auth.ts`, which uses `@clerk/backend` (Node-clean), maps the
Clerk user to the application `User`, rejects a session the caller does not
own, and returns the principal. Tools read that principal back from
`ctx.session.auth.current`, normally via `requireCurrentAgentActor` in
`agent/lib/actor.ts`, and `runAuditedAgentOperation` re-checks session
ownership inside the transaction it audits. No tool needs Clerk itself.

`tests/agent/authored-package-boundary.test.ts` fails in about a second when
authored agent code reaches a package Node cannot load, and prints the import
chain that caused it. CI's "Eve build" job catches the same class, more slowly
and without naming the chain.

Session titles are generated after the event is persisted through the injected
AI Gateway model (`meta/llama-3.1-8b-instruct`). The generator normalises the
incoming text, wraps it in `<user_message>` as source material, and requests a
3–7 word Australian-English title. It has a five-second timeout and returns
`null` on empty input, invalid output, or generation failure; title generation
is asynchronous and never delays event persistence.
