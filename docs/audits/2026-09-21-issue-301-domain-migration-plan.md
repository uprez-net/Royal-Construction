# Issue #301 — the original audit, plan and issue body (archived)

Archived here on 2026-09-22 from GitHub issue
[#301](https://github.com/uprez-net/Royal-Construction/issues/301), whose body
was rewritten to report against these gates and whose two comments were then
deleted as redundant. This is the only remaining copy of that material, which
is why it is in the repository rather than in `tmp/`.

Read it as history, not as instructions. The living guidance is
`lib/domain/README.md`, `lib/domain/GUIDE.md` and the domain section of
`AGENTS.md`; the phase-by-phase record is
`tmp/ISSUE-301-DOMAIN-MIGRATION-TODO.md`; current status is the issue body.

---

## 1. The issue body as originally filed

Found while fixing the eve build break in PR #295, investigated properly in PR #300.

## The constraint

`eve build` leaves installed packages external and loads them with Node's own ESM loader. Two things make `lib/data/*` unreachable from `agent/`:

- **18 modules under `lib/` value-import `@clerk/nextjs`** at module scope — 13 of them in `lib/data/`. Clerk's ESM build has extensionless relative imports Node cannot resolve.
- **Most `lib/data/*` modules open with `import "server-only"`**, which throws on import outside a React bundler.

Both are fatal, and both were reproduced against `eve build`:

| probe | `eve build` |
|---|---|
| a tool importing `@/lib/data/agent-sessions` | exit 1 (`@clerk/nextjs` extensionless import) |
| a tool containing only `import "server-only"` | exit 1 ("cannot be imported from a Client Component module") |
| clean | exit 0 |

## The cost

`agent/lib/lead-operations.ts`, `offer-operations.ts`, `project-operations.ts`, `tradie-operations.ts` and `admin-operations.ts` reimplement domain operations that `lib/data/` also implements. Two implementations of the same business rules, and nothing keeps them in step — a rule fixed in one can stay broken in the other indefinitely, and neither side's tests would notice.

This is not hypothetical: the lead fixes in PR #295 went into `lib/data/`, and whether the agent's lead operations have the equivalent behaviour is an open question nobody is currently positioned to answer.

## The fix

The pattern PR #295 used for `lib/data/lead-tasks.ts`, applied more widely. That module needed the acting user; instead of importing Clerk, it takes `actingUserId` as a parameter and the two routes that have a signed-in user resolve it at the boundary.

Generalised:

- split each `lib/data/X.ts` into a **pure domain module** that takes `actingUserId` (and optionally a `TransactionClient`) as arguments, and a **thin Next-only wrapper** that calls `auth()` and delegates;
- keep `import "server-only"` on the wrapper, never on the domain module;
- let both `app/` routes and `agent/` tools call the domain module.

Incremental by construction — one data module at a time, starting with whichever the agent duplicates most.

`tests/agent/authored-package-boundary.test.ts` (PR #300) keeps the boundary honest while this happens: it fails in under a second and names the offending import chain, rather than surfacing as a cryptic eve error at the end of CI.

No behaviour change is required to close this. It is a refactor to stop the agent and the app forking.

---

## 2. First comment — validation on `staging` and the first slice

Validated on `staging`:

- The original Eve import failure is no longer reproducible after PR #300: `tests/agent/authored-package-boundary.test.ts` passes 3/3, and `eve build` reaches the Nitro server build. The command then fails only while renaming `.output` with `EPERM`, not on a Next/Clerk import.
- The architectural issue remains real: Next-coupled `lib/data/*` modules still cannot be reached from Eve, and specialist modules still duplicate domain persistence rules.

Implemented the first incremental slice:

- Added the Node-safe, transaction-capable `updateAdminOfferContentSection` service in `lib/data/admin-offer-content-writes.ts`.
- Made the app's five admin-content writers delegate through that shared service.
- Changed `agent/lib/admin-operations.ts` to use the same optimistic-version update path instead of duplicating its Prisma update and conflict handling.
- Added a regression assertion that the agent uses the shared service and does not write `adminOfferContent` directly.

Verification: focused agent suite 35/35 passed, boundary suite passed, lint passed, and `pnpm typecheck` passed. The full repository test command could not start because the environment hit `uv_os_get_passwd ENOMEM`.

Leaving this issue open for the remaining lead/offer/project/tradie domain migrations; the build symptom itself is stale.

---

## 3. Second comment — the full-codebase audit and migration plan

## Full-codebase audit and single-source-of-truth migration plan

### Audit result

The issue is real, but it is larger than the original Eve build error.

- `lib/data` contains 58 modules.
- 47 of those modules directly import a Next/Clerk-only runtime or `server-only`.
- The five Eve specialist operation files contain about 4,849 lines and still issue direct Prisma reads/writes:
  - `agent/lib/lead-operations.ts` — 408 lines
  - `agent/lib/offer-operations.ts` — 1,242 lines
  - `agent/lib/project-operations.ts` — 1,487 lines
  - `agent/lib/tradie-operations.ts` — 1,054 lines
  - `agent/lib/admin-operations.ts` — 658 lines
- Eve currently reaches only a small Node-safe allowlist: lead tasks, session titles, Xero status, and admin offer-content writes. The package-boundary test passes, but it proves only loadability; it does not prevent the same business rule being implemented in two places.
- The other operational callers are also part of the audit: App pages, route handlers, Server Actions, Graph handlers, Workflow handlers, cron jobs, Clerk/Xero/DocuSign webhooks, file upload routes, and the legacy MCP adapter.

The target is not merely “make Eve build.” The target is:

> Every business rule, authorization rule, state transition, persistence mutation, optimistic-concurrency check, and external-side-effect decision has one domain implementation. App, Eve, Graph, Workflow, cron, webhook, public, and legacy adapters only authenticate/validate/format and call that implementation.

### Required architecture

Introduce a Node-safe domain layer under `lib/domain/` (the exact folder names can be adjusted during implementation) and make `lib/data/` a compatibility layer during migration.

1. Domain services

   - Accept an explicit database dependency: `Prisma.TransactionClient | PrismaClient`.
   - Accept an explicit application principal/actor, never Clerk `auth()`, `@clerk/nextjs`, `next/cache`, `next/server`, `server-only`, request headers, or Eve context.
   - Own validation that is intrinsic to the business rule, authorization predicates, query scopes, state machines, optimistic concurrency, transaction boundaries, and durable writes.
   - Return typed domain records/results, not React/UI models and not Eve result envelopes.
   - Take external capabilities through explicit ports/adapters where the operation sends email, calls Graph/DocuSign/Xero/Novu, reads Blob, generates files, or schedules post-commit work.
   - Throw typed errors for rejected input, authorization, stale versions, missing records, unavailable transitions, and failed side effects. No success result may be returned after a failed write.

2. Next/App adapters

   - Resolve Clerk identity and application `User` at the boundary.
   - Call the domain service with the actor and database.
   - Own cache tags, `cacheLife`, `revalidateTag`, `updateTag`, `after`, Server Action serialization, and HTTP status mapping.
   - Remain the only place that imports Next-only packages.

3. Eve adapters

   - Parse the Eve contract and bounded input.
   - Read the current actor from `ctx.session.auth.current`.
   - Use `runAuditedAgentOperation` for every mutation, including idempotency, session ownership, audit, and transaction handling.
   - Request owner-only approval where the operation requires it.
   - Call the same domain service as the App adapter.
   - Map the typed domain result to an Eve result envelope. No direct business Prisma queries/writes remain in `agent/lib/*-operations.ts`.

4. Other adapters

   - Graph, Workflow, cron, webhook, public-booking, upload, and legacy MCP routes authenticate their own channel and pass a principal/system actor to the same domain service.
   - The MCP adapter remains a transport adapter only if it is retained; it must not be a third business implementation.
   - Public booking and inbound webhook flows must pass an idempotency key and an explicit unauthenticated/system principal where appropriate.

5. External side effects

   Define small ports/adapters for email, Graph, DocuSign, Xero, Novu, Blob/file storage, and PDF/document generation. A domain command must make the database state and the side-effect intent durable together, or use an explicit post-commit/outbox path with idempotency. Do not call external services inside a transaction unless the operation is deliberately non-transactional and audited as such.

### Complete module inventory

These are all 58 current `lib/data` modules and their migration homes.

- Identity, access, audit, and agent session infrastructure:
  - `acting-user.ts`
  - `user.ts`
  - `offer-access.ts`
  - `project-access.ts`
  - `actionLog.ts`
  - `agent-sessions.ts`
  - `agent-session-titles.ts`
- Leads and shared lead lifecycle:
  - `leads.ts`
  - `lead-tasks.ts`
  - `dashboard.ts` (follow-up queries and lead-scoped dashboard rules)
  - `sync-lead-stage.ts`
- Offers and commercial lifecycle:
  - `offers.ts`
  - `offer-listing.ts`
  - `offer-workspace.ts`
  - `offer-activity.ts`
  - `offer-activity-types.ts`
  - `offer-inclusion-check.ts`
  - `offer-prefill.ts`
  - `offer-send.ts`
  - `offer-accept-sign.ts`
  - `offer-tender-sign.ts`
  - `offer-contract-sign.ts`
  - `offer-project-handoff.ts`
  - `offer-image-ai.ts`
  - `offer-image-import.ts`
- Projects, milestones, resources, and project support:
  - `projects.ts`
  - `projectsWrite.ts`
  - `projectFlow.ts`
  - `projectReadiness.ts`
  - `projectUpdates.ts`
  - `milestones.ts`
  - `material.ts`
  - `customers.ts`
  - `siteManagers.ts`
  - `variations.ts`
- Compliance lifecycle:
  - `compliance.ts`
  - `compliance-alerts.ts`
  - `compliance-applications.ts`
  - `compliance-architect.ts`
  - `compliance-certificate.ts`
  - `compliance-developer.ts`
  - `compliance-development-application.ts`
  - `compliance-follow-up.ts`
  - `compliance-issued-items.ts`
  - `compliance-outreach.ts`
- Tradie, schedule, approval, and admin operations:
  - `tradies.ts`
  - `tradie-management.ts`
  - `tradieSchedules.ts`
  - `tradie-approvals.ts`
  - `tradie-dashboard.ts`
  - `admin-offer-content.ts`
  - `admin-offer-content-coerce.ts`
  - `admin-offer-content-writes.ts`
  - `xero-connection.ts`
- Shared support and external integrations:
  - `file.ts`
  - `invoice.ts`
  - `insurance.ts`
  - `email-ad-hock.ts`

The current shared exceptions are useful patterns, not reasons to stop: `lead-tasks.ts`, `agent-session-titles.ts`, `xero-connection.ts`, the coercion/pure helper modules, and the newly shared admin-content write path should be retained or moved into the domain layer with tests.

### Domain-to-adapter migration map

#### Phase 0 — lock the architecture before moving code

- Add an import-boundary test that traces all authored code reachable from `agent/` and rejects Next-only packages.
- Add a stronger specialist rule: `agent/lib/*-operations.ts` may use agent infrastructure and domain modules, but may not import `@/lib/prisma` or issue business-model Prisma queries/writes.
- Permit direct Prisma only in explicitly named agent infrastructure modules: channel authentication, actor lookup, audited operation/idempotency, event persistence, and session/memory infrastructure.
- Add a dependency rule that `lib/domain/**` cannot import `app/**`, `agent/**`, `next/**`, `@clerk/nextjs`, or `server-only`.
- Create contract tests for every migrated command that invoke the same domain service through at least the App adapter and Eve adapter.
- Record the old/new operation names and one canonical owner for each rule before moving it. Delete old implementations as soon as callers move; do not leave “temporary” copies without an owner and removal issue.

#### Phase 1 — shared identity, authorization, and persistence primitives

Consolidate:

- Application-user lookup and role rules from `user.ts` and `acting-user.ts`.
- Lead access and list scope from `lib/offer/access.ts`.
- Project/site-manager access from `project-access.ts` and the project checks in Eve.
- Tradie visibility and project/schedule visibility from the Eve tradie code and `tradie-management.ts`/`tradies.ts`.
- Admin requirement checks and the shared approval policy.
- Audit/action-log writes and session ownership checks.

The result should expose explicit functions such as `authorizeLead`, `authorizeOffer`, `authorizeProject`, `authorizeTradie`, `requireAdmin`, and `authorizeAgentSession`, each with one implementation and consistent denial semantics. App and Eve adapters may translate errors differently, but may not invent a second scope query.

#### Phase 2 — leads

Canonical domain commands and queries:

- Search/list leads with the same `leadListScope` used by detail access.
- Get lead detail/history with untrusted-text handling.
- Create, update, archive/delete, and close/reopen lead rules.
- Lead stage transitions, close-date rules, lost-reason rules, and stage-derived analytics.
- Lead task list/create/complete/reopen/delete, including history entries and Sydney date conversion.
- Follow-up/dashboard queries scoped to the caller's readable leads.
- Lead email preparation/sending and public consultation booking deduplication.

Callers to migrate together:

- `agent/lib/lead-operations.ts`
- `lib/data/leads.ts`, `dashboard.ts`, `lead-tasks.ts`, `sync-lead-stage.ts`
- lead App routes and Server Actions
- Graph booking/notification handlers
- public booking route
- inbound lead webhook
- workflow follow-up routes and dashboard pages

Keep task history and the underlying task write atomic. Preserve the existing fix that does not report a successful task when history persistence failed.

#### Phase 3 — offers and customer-visible commercial data

Canonical domain commands and queries:

- Offer listing/grouping/KPI representative-revision selection.
- Offer access by lead scope.
- Offer detail/workspace load and save.
- Workspace patch allowlists, optimistic `stateVersion`, pricing/GST split, contract particulars, and persisted workspace validation.
- Offer status state machine, status-event history, and the single lead-stage synchronization rule.
- Offer revision creation, superseding, project handoff, and frozen snapshots.
- Change requests/activity.
- Inclusion checks and highlights.
- Send/accept/tender/contract signing, recall, signing-status polling, and DocuSign envelope rules.
- Image import/AI assistance as external adapters, not duplicated business writes.
- Admin offer defaults/prefill and version checks.

Callers to migrate together:

- `agent/lib/offer-operations.ts`
- `offers.ts`, `offer-listing.ts`, `offer-workspace.ts`, `offer-activity.ts`, `offer-inclusion-check.ts`, `offer-prefill.ts`, `offer-send.ts`, `offer-accept-sign.ts`, `offer-tender-sign.ts`, `offer-contract-sign.ts`, `offer-project-handoff.ts`, `offer-image-ai.ts`, `offer-image-import.ts`
- offers pages, slices, Server Actions, Graph/workflow/Docusign routes, and MCP handlers

This phase is high priority because quoted prices, GST totals, contract terms, signing status, and dates are customer-visible. Add parity tests for every status transition and every calculated total before deleting the Eve copy.

#### Phase 4 — projects, milestones, resources, and readiness

Canonical domain commands and queries:

- Project list/detail/KPI/export/lookup and project access.
- Project creation, customer resolution, site-manager validation, lead handoff, and milestone template creation.
- Project requirements payload construction and optimistic section updates.
- Project readiness/date blockers.
- Milestone create/update/photo attachment and project updates.
- Materials and variations, including the currently unavailable Eve variation surface.
- Invoice creation/synchronization and HBCF/insurance reads.
- File attachment authorization.

Callers to migrate together:

- `agent/lib/project-operations.ts`
- `projects.ts`, `projectsWrite.ts`, `projectFlow.ts`, `projectReadiness.ts`, `projectUpdates.ts`, `milestones.ts`, `material.ts`, `customers.ts`, `siteManagers.ts`, `variations.ts`, `invoice.ts`, `insurance.ts`, `file.ts`
- project pages, API routes, Server Actions, upload routes, Graph/workflow/MCP handlers, and the project-creation agent

Do not let the agent implement variations until the shared variation domain service exists. The future Eve tool must call the same variation command as the App route.

#### Phase 5 — compliance

This must be extracted by command/state boundary rather than copying the current 68k-line aggregate into another place.

Canonical domain areas:

- Engagement start, access, status, and completion.
- Required-document templates and development-application document initialization.
- Compliance document attach/classify/review/resolve/not-required.
- Alert creation, resolution, system resolution, and alert prerequisites.
- External application/principal-certifier/portal determinations.
- Architect meeting/plans/waste-management transitions.
- Developer requirement/estate/decision/resend transitions.
- Certificate issuance and “close only when complete.”
- Party outreach, prerequisite blocking, reply, follow-up, attachments, and delivery status.
- Issued-item correspondence and checklist application.
- Sanitization and untrusted evidence handling.

Callers to migrate together:

- all `lib/data/compliance*.ts` modules
- `agent/lib/project-operations.ts`
- compliance API routes
- `lib/workflow/certifier-email.ts`, `party-email.ts`, `compliance-checklist.ts`, and project workflow code
- cron alert/follow-up handlers
- Graph and external email routes
- future project specialist tools

Every state transition must have one state-machine function and one audit/history policy. Email delivery must be represented as a durable, retry-safe command; a successful HTTP response must never mean “the database write probably happened.”

#### Phase 6 — tradies, schedules, approvals, and admin

Canonical domain commands and queries:

- Tradie directory/search/detail and safe serialization.
- Tradie create/update/favourite/delete.
- Price change and removal approval requests.
- Ratings and incident creation/resolution.
- Schedule create/bulk-create/update/reschedule/transition/delete-request.
- Overlap checks, project/site-manager scope, schedule state machine, quote basis/amount calculations, and reminders.
- Approval queue, claim/resolve semantics, rejection reasons, deletion keys, and affected-record mutations.
- Admin offer content reads/writes and version conflicts.
- Team invitation/role update/revocation and last-admin protection.
- Xero connection status/disconnect.

Callers to migrate together:

- `agent/lib/tradie-operations.ts`
- `agent/lib/admin-operations.ts`
- `tradies.ts`, `tradie-management.ts`, `tradieSchedules.ts`, `tradie-approvals.ts`, `tradie-dashboard.ts`, `admin-offer-content.ts`, `admin-offer-content-writes.ts`, `user.ts`, `xero-connection.ts`
- tradie/admin pages, Redux slices, API/Graph routes, cron/reminder handlers, MCP handlers, and Eve tools

The admin-content write extraction already completed is the model for this phase: one Node-safe persistence service, thin framework wrappers, and the Eve adapter calling that service.

#### Phase 7 — support services and legacy cleanup

Classify every remaining support module as either a shared domain service or an explicitly app-only adapter:

- `file.ts`: shared file metadata/attachment authorization; Blob transport behind a port.
- `invoice.ts`: shared invoice state and totals; Xero transport behind a port.
- `insurance.ts`: shared HBCF timeline/breach calculations.
- `email-ad-hock.ts`: email composition/dispatch port; no business mutation hidden in an email helper.
- `agent-sessions.ts` and `agent-session-titles.ts`: shared session registry/title persistence with Next page adapters and Eve channel/event adapters.
- `actionLog.ts`: one audit/logging service used by workflow, routes, and domain commands.
- Remove or rename old `lib/data` functions only after all App, Eve, Graph, Workflow, cron, webhook, public, and MCP callers point at the domain owner.

### Completion gates

Issue #301 should not be closed until all of these are true:

- No Eve specialist operation file contains direct business Prisma access.
- No domain module imports Next-only packages, Clerk Next bindings, or Eve packages.
- Every `lib/data` export is either a thin framework adapter or a clearly documented app-only read with no duplicated business mutation.
- Every business mutation has one domain implementation and one authorization policy.
- Every external side effect has an explicit adapter/port, durable intent, and idempotency strategy.
- Lead, offer, project/compliance, tradie, admin, public booking, webhook, Graph, Workflow, cron, upload, and MCP callers all use the same domain commands.
- Optimistic concurrency and state transitions are tested through both App and Eve adapters.
- Customer-visible prices, totals, dates, documents, signing state, and emails have parity tests.
- Public/unauthed routes have replay/idempotency tests and cannot widen access.
- Audit tests verify owner-scoped Eve sessions, approvals, idempotency, and persisted outcomes.
- Static architecture tests fail on any new duplicate Prisma write in `agent/lib/*-operations.ts` or any new Next-only import in `lib/domain/**`.
- The old duplicate implementations are deleted, not left as parallel “temporary” paths.

This is the migration plan for full coverage. The work should be delivered in the phases above, with one PR per bounded context and the inventory updated in this issue after each phase.
