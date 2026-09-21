# `lib/domain` — the one implementation of every business rule

Issue #301. Before this layer existed a rule could live in `lib/data/*` for the
app and again in `agent/lib/*-operations.ts` for Eve, and the two drifted. The
package-boundary test proved Eve's copy _loaded_; nothing proved it agreed.

A domain module owns the rule. Everything else — App pages, Server Actions,
route handlers, Eve tools, Graph and Workflow handlers, crons, webhooks, the
public booking route, the legacy MCP adapter — is an adapter that
authenticates, validates its own transport, calls the domain, and formats the
answer.

## The contract

A domain module:

- **Takes its database explicitly.** First-class parameter of type
  [`DomainDb`](./db.ts) (`Prisma.TransactionClient | PrismaClient`), so the same
  function composes inside a caller's transaction or runs on its own. It never
  reaches for the ambient client.
- **Takes its caller explicitly.** A [`DomainPrincipal`](./principal.ts), never
  `auth()`, `@clerk/nextjs`, request headers, or an Eve `ctx`. Crons and
  webhooks call `systemPrincipal(reason)` with a stable audit label naming the
  authenticated channel; open routes call `anonymousPrincipal(source)` with a
  stable label naming the public entry point. "Nobody is signed in" is a value
  here, not an exception.
- **Owns the rule.** Intrinsic validation, authorization predicates, query
  scopes, state machines, optimistic concurrency, transaction boundaries, and
  the durable write.
- **Returns typed domain records.** Not React view models, not Eve result
  envelopes. Adapters shape those.
- **Throws** [`DomainError`](./errors.ts) subclasses. Never returns a success
  result after a failed write.
- **Takes external capabilities as ports.** Email, Graph, DocuSign, Xero, Novu,
  Blob, PDF generation arrive as injected adapters. A command makes the database
  state and the side-effect intent durable together, or uses an explicit
  post-commit/outbox path with an idempotency key.

## What a domain module may not import

`app/**`, `agent/**`, `next/*`, `@clerk/nextjs`, `@clerk/mcp-tools`,
`server-only`, `react`. Enforced by
`tests/architecture/domain-boundary.test.ts`, which fails in about a second and
names the import chain.

This is not only about `eve build` (see AGENTS.md — those packages publish
extensionless relative imports that only a bundler resolves, so a value import
from `agent/` fails the build). It is about the rule staying callable from
every channel: a cron, a webhook and a test runner are all plain Node too.

## Where identity comes from

| Adapter | Resolves identity with | Passes |
| --- | --- | --- |
| App page / Server Action / route | Clerk `auth()` + application `User` lookup | `UserPrincipal` |
| Eve tool | `ctx.session.auth.current` via `requireCurrentAgentActor` | `UserPrincipal` |
| Cron / webhook / Graph subscription | its own channel secret | `systemPrincipal(reason)`, where `reason` identifies the authenticated channel in audit history |
| Public booking | nothing — the route is open | `anonymousPrincipal(source)`, where `source` identifies the public entry point in audit history |

## Layout

```
lib/domain/
  README.md      this contract
  db.ts          DomainDb
  errors.ts      the error taxonomy adapters map from
  principal.ts   who is asking
  outbox.ts      durable intent for an external effect
  ports/         external capabilities the domain is handed
  <context>/     one folder per bounded context (leads, offers, projects, …)
```

Each bounded-context folder gets `commands.ts` / `queries.ts` / `policy.ts` as
it grows. A capability several contexts need lives in `ports/`; one only a
single command needs can stay a parameter type on that command.

## External effects

A command that reaches outside the database takes the capability as a
parameter and, where a duplicate would cost something, records a durable
intent first through [`outbox.ts`](./outbox.ts).

- **Take the capability, do not import the provider.** The rule and the effect
  belong in the same call. When a command only returned "yes, this URL is in
  scope" and an adapter did the deleting, nothing proved the adapter acted on
  the answer, and no test of the rule could show the delete had not happened.
- **`runOutboxEffectWithOutcome` reports a replay.** A caller that answers
  "sent" for a replayed intent is telling the office an email went out when
  none did. Decide what to say about it.
- **Pick the idempotency key for how long the effect stays the same.** A key
  with no time in it deduplicates for ever, which is how a re-invitation and a
  second reminder became permanent no-ops behind a success response.
- **`repeatable` is opt-in.** Default is that an ambiguous failure is terminal
  until a human looks, because a duplicate customer email or invoice is the
  expensive outcome. Set it only where a second run lands the same state, like
  overwriting a PDF at a path derived from its invoice id.
- **`OutboxEventKind` may not grow entries nothing produces.** A kind with no
  producer reads as "this effect is durable" when it is not;
  `tests/architecture/domain-outbox-coverage.test.ts` fails on one.

## Migration state

`lib/data/` is a compatibility layer while phases land. A `lib/data` module is
finished when it is either a thin framework adapter (cache tags, `revalidateTag`,
Server Action serialization) over a domain call, or a documented app-only read
with no duplicated mutation. Track progress in
`tmp/ISSUE-301-DOMAIN-MIGRATION-TODO.md`; record every old → new move in that
file's ownership ledger and delete the old implementation in the same PR.
