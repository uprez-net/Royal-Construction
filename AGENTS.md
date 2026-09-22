<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Who actually uses this

Royal Constructions is a residential construction business with **two to three
employees**. They share **one or two login IDs** and everyone is an `ADMIN`.
Site managers become real only once the Projects section ships; until then the
`SITE_MANAGER` role exists in the schema but nobody holds it.

This is calibration, not permission to cut corners. It changes which problems
are worth solving now:

**Worth less than it looks**

- **Races between two different users.** Two of three people rarely touch the
  same record in the same second. Weigh a concurrency bug by whether ONE person
  can trigger it — a double-click, a retry after a timeout, two tabs — not by
  whether it is theoretically reachable. Say which kind it is.
- **Role scoping between internal staff.** Everyone is an ADMIN on a shared
  login, so "user A should not see user B's leads" describes nobody today.
  Correct scoping is still worth writing when it is nearly free, and
  `leadListScope` already exists — use it rather than inventing a second rule.
  But do not build machinery for a hierarchy that does not exist yet.
- **Internal-only cosmetics.** Nobody outside the office sees them.

**Worth more than it looks**

- **Anything a client sees.** An email, a PDF, a DocuSign envelope, a quoted
  price, a date. A wrong number in front of a customer is the expensive kind of
  mistake here, and there is no support team to absorb it.
- **Anything reachable without logging in.** The public booking route and the
  inbound lead webhook are on the open internet; the shared-admin argument
  gives them no cover at all.
- **Silent failure.** Reporting success while committing nothing is worse than
  an error, because with three people and no on-call there is nobody watching
  logs — the first sign is a client asking why they never heard back.
- **Anything that loses data or money.**

When an issue's severity depends on which of these it is, say so explicitly
instead of assigning a generic priority.

## Business rules live in `lib/domain`, and the guide is the standard

**Before writing or changing any business rule, authorization check, state
transition, persistence mutation or external-side-effect decision, read
[`lib/domain/GUIDE.md`](./lib/domain/GUIDE.md) and follow it.**
[`lib/domain/README.md`](./lib/domain/README.md) says what a domain module is;
the guide says what to do when you have a change to make — which folder owns
what, what to call instead of writing it again, the command signature, the
error taxonomy, and the order to move one rule in.

App routes, Server Actions, Eve tools, cron jobs, webhooks, Graph and Workflow
steps and the public routes are **adapters**. They authenticate, validate,
format and call a domain command. They do not decide anything.

### Why this is a rule and not a preference

Because the same business rule used to be written twice — once for the screen
and once for Eve — and the two copies did not agree. Every one of these was
found by putting them side by side, and each was live:

- A compliance document could be **approved before the certifier had ever been
  sent it**. The app checked the outbound mail trail first; Eve had no
  equivalent check, so an agent could close an engagement on a review that
  never happened.
- The app's `createTradieSchedule` wrote the booking **with no overlap check
  and no check that the milestone belonged to the project** — the same tradie
  could be booked onto two sites for the same week. Eve had both checks.
- The **last-admin guard** existed only in Eve's team tool. Everyone here is an
  ADMIN on a shared login, so demoting the last one locks the business out with
  nobody left who can undo it.
- Five send routes read an `Idempotency-Key` header that **no caller sent**, so
  every send fell back to a derived key bucketed by day or by body checksum. A
  second follow-up the office meant to send was reported as sent and emailed
  nobody.

Note what these have in common: they are not abstract layering problems. They
are a wrong decision in front of a client, an access check that quietly stopped
checking, a lockout, and a silent failure — the four things the section above
says are worth more than they look here. One copy of a rule is how you stop
writing them.

So: a second copy of a rule is a defect in this repo, not a style question. If
you find a rule that already exists, call it. If you find two that disagree,
resolve them into one — the stricter one — and say in the change which
behaviour you kept and which you dropped, because one of the two callers is
about to start behaving differently.

### The guards, and what they do not catch

- `tests/architecture/domain-boundary.test.ts` — `lib/domain/**` may not reach
  Next, Clerk's Next bindings, React, Eve, `app/`, `agent/` or `components/`.
  Transitive, value edges only, prints the import chain.
- `tests/architecture/agent-operations-prisma.test.ts` — a per-file **ratchet**
  on direct business Prisma in `agent/lib/*-operations.ts`. The number may only
  go down. A new specialist file starts at 0.
- `tests/architecture/domain-error-surfacing.test.ts` — an adapter that catches
  a domain refusal must surface it (`lib/http/domain-response.ts`) or be listed
  with a reason, so an operator never reads a generic 500 for a refusal the
  domain can name.
- `tests/architecture/idempotency-keys.test.ts` — every route that reads an
  `Idempotency-Key` must have a caller that sends one.
- `tests/agent/authored-package-boundary.test.ts` — see the Eve section below.

These catch new duplication at the boundaries. **They cannot tell you that two
rules in two places mean the same thing** — that is the part that needs you to
search first, which is what section 1 of the guide is for.

## The suite runs on Vitest

`node:test` is gone (issue #326). A new test imports `test`/`describe`/`it` and
the lifecycle hooks from `vitest`, and keeps asserting with
`node:assert/strict` — the assertions were never the thing being migrated, and
mixing in `expect` would leave two idioms side by side.

Practical rules, all of which the suite already follows:

- Put the file at `tests/<area>/<name>.test.ts`; that is what
  `vitest.config.mts` collects. A helper or fixture that is not a test does not
  end in `.test.ts`, so it is imported rather than run.
- Reach application code through `@/` (`@/lib/offer/pricing`) and sibling
  fixtures relatively (`./tender-fixtures`). The distinction carries meaning:
  relative is "next to this test", `@/` is "the code under test".
- Need the repository root? Import `REPO_ROOT` from `tests/support/repo-root.ts`.
  `__dirname` does not exist under the ESM transform, and `process.cwd()` is
  wherever the command was typed.
- Mutating `process.env`, or anything else global, still gets restored in
  `afterEach`. Per-file process isolation is a second line of defence.
- Anything that needs a real browser belongs in the `print` project in
  `vitest.config.mts`, not in the CI lane. It must still fail loudly when
  Chromium is missing — never `skip`.

`pnpm test:unit` is what CI runs; `pnpm test:watch` is the loop to work in.

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
relative imports that only a bundler resolves, `@clerk/mcp-tools` exports no
entrypoint Node can resolve, and `server-only` throws on import outside a React
bundler. A value import of any of them from `agent/`
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
