# How to add to this layer without starting a third copy of a rule

[`README.md`](./README.md) says what a domain module **is**. This says what to
do when you have a change to make: which folder owns what, what to call instead
of writing it again, and the order to move one rule in.

It exists because the failure this layer was built to end is not exotic. It is
somebody in a hurry adding `prisma.project.update(...)` to the file they already
had open, because finding the command that already does it took longer than
writing a new one. Everything below is aimed at making the second option
cheaper than the first.

---

## 1. Before you write anything: is the rule already here?

Search in this order. Most of the time the answer is in the first two.

| Looking for | Look in |
| --- | --- |
| "may this caller do X?" | [`access/`](./access) — leads, offers, projects, tradies, agent sessions |
| "who is asking?" | [`principal.ts`](./principal.ts) |
| A business operation on a record | `<context>/commands.ts`, or the module named after the operation (`offers/status.ts`, `projects/milestones.ts`) |
| A list or a detail read | `<context>/queries.ts` |
| Who a user is, who the admins are | [`identity/`](./identity) |
| An activity-log row | [`audit/action-log.ts`](./audit/action-log.ts) |
| An email, a document, a Blob, an AI call | [`ports/`](./ports) |
| "make sure this external effect happens once" | [`outbox.ts`](./outbox.ts) |
| The error to throw | [`errors.ts`](./errors.ts) |

If you find something close but not identical, **stop and decide which it is**
before writing code:

- The same rule, spelled differently → one command, the stricter version, and
  delete the other. Record the move in the ownership ledger in
  `tmp/ISSUE-301-DOMAIN-MIGRATION-TODO.md`.
- Two genuinely different rules that look alike → keep both, name each for what
  it *decides*, and say in a comment why they differ. `canManageProject` and
  `canAttachFileToProject` are the worked example: "manage a project" and
  "attach a file to a project" read like one rule and are not.

Widening a rule to cover a second case is how an access check quietly stops
checking. `projectReadScope`, `projectManageScope` and `canEditProject` are
three scopes on one table for exactly this reason.

---

## 2. Which folder owns what

```
lib/domain/
  README.md       the layer contract
  GUIDE.md        this file
  db.ts           DomainDb — the database a command is handed
  errors.ts       the refusal taxonomy every adapter maps
  principal.ts    who is asking; INTERNAL_ROLES; requireAdminPrincipal
  outbox.ts       durable intent for an external effect
  ports/          external capabilities, as types the domain is handed
  access/         authorization predicates and query scopes, per context
  audit/          the activity log
  identity/       users, team, customers, site managers
  admin/          admin-owned content (offer boilerplate)
  agent/          Eve's own owner-scoped session reads
  comms/          SMS and phone calls: sends, inbound, statuses, the call
                  router, recordings — carriers arrive through ports/comms
  compliance/     certifier engagement, documents, file reclamation
  email/          ad-hoc and campaign email rules
  insurance/      HBCF reads
  integrations/   Xero connection state
  invoices/       progress claims: sync, stage creation, stage-claim decision
  leads/          the lead record, tasks, booking, stage projection
  offers/         the quote: workspace, status, revisions, signing, sending
  projects/       projects, milestones, variations, materials, readiness
  tradies/        directory, schedules, incidents, approvals, reminders
  whatsapp/       what leads and project groups share: inbound media
```

Rules of thumb:

- **A folder per bounded context**, not per table. `projects/` holds milestones
  and variations because neither means anything without the project.
- **`access/` is separate from the context folder** because a scope is used by
  reads, writes and listings alike, and putting it in one of them makes the
  other two import sideways.
- **A capability two contexts need goes in `ports/`.** One that a single
  command needs can stay a parameter type on that command.
- **New context?** Start with `queries.ts` and `commands.ts`, and split out a
  module per operation when one of them passes a few hundred lines
  (`offers/` is the shape that ends up in).

---

## 3. The signature

Every command and query looks like this:

```ts
export async function doTheThing(
  principal: DomainPrincipal,   // who is asking
  input: DoTheThingInput,       // already parsed by the transport
  db: DomainDb,                 // the caller's transaction, or the client
  ports: { sendEmail?: EmailPort } = {},  // only if it reaches outside
): Promise<DoTheThingResult> {
```

- **`principal` first.** Not `userId`, not a `User` row: a cron and the public
  booking route have no user, and `DomainPrincipal` makes them say so instead
  of passing `null` and being guessed at.
- **`db` explicitly, and last of the required three.** Never
  `import prisma from "@/lib/prisma"` — that is the one import that makes a
  command uncallable from Eve, a cron and a test.
- **`DomainDb` unless you must own the transaction.** A command that needs its
  own takes `TransactionalDomainDb`, which a caller already inside a
  transaction cannot satisfy — which is the point.
- **Return a typed record, not a view model and not an Eve envelope.** Include
  what the adapters need to do their post-commit work: the recipients to
  notify, whether this call was the one that closed the thing, the id to
  invalidate. `UpdateMilestoneOutcome` is the example.

### What the command owns

Intrinsic validation, authorization, query scope, the state machine,
optimistic concurrency, the transaction boundary and the durable write.

### What the adapter keeps

`revalidateTag`, `after()`, `cacheTag`/`cacheLife`, Clerk, the provider SDK
behind a port, and shaping the response. If you are about to import `next/*` or
`@clerk/nextjs` into `lib/domain`, you have put adapter work in a command.

---

## 4. Common calls, so you do not write a second one

| Instead of | Call |
| --- | --- |
| `role === "ADMIN" ? {} : { assignedId: userId }` | `leadListScope(principal)` |
| `role === "ADMIN" ? {} : { siteManagerId: userId }` | `projectManageScope(principal)` |
| listing projects for a screen | `projectReadScope(principal)` |
| "can they edit this project's fields?" | `canEditProject` / `authorizeProjectEdit` |
| looking a project up and checking access | `authorizeProject(principal, id, db)` |
| a milestone id from outside | `authorizeMilestone` — it resolves the project itself |
| `[Role.ADMIN, Role.SITE_MANAGER, Role.GUEST]` | `INTERNAL_ROLES` / `isInternalRole` |
| "is this a staff caller or a cron?" | `isInternalPrincipal(principal)` |
| `resolveActingUserId()` | `attributionUserId(principal)` — `null` is a normal answer |
| `prisma.activityLog.create` | `logAction(entry, db)`, or `logActionOrThrow` when the audit is part of the promise |
| `prisma.user.findUnique({ where: { clerkId } })` | `findUserByClerkId(clerkId, db)` |
| every admin's id, for a notification | `findAdminUserIds(db)` |
| application ids → Clerk ids | `resolveClerkIds(ids, db)` |
| resolving the customer for a new project | `resolveCustomerForProject(input, db)` |
| checking a site manager id | `requireAssignableSiteManager(id, db)` |
| "did settling this milestone finish a claimable stage?" | `resolveDueStageClaim({ projectId, milestoneId }, db)` |
| calling an email/Blob/DocuSign/Xero SDK from a rule | take a port from `ports/` |
| "make sure this send happens once" | `runOutboxEffectWithOutcome` |

In an adapter:

| Instead of | Call |
| --- | --- |
| `auth()` then a user lookup | `currentPrincipal()` from `lib/data/current-principal.ts` |
| `catch { return 500 }` around a domain call | `domainErrorResponse(error)` from `lib/http/domain-response.ts` |
| a Server Action throwing a refusal | `domainActionFailure(error)` — a throw becomes a digest across that boundary |
| `import prisma` inside an Eve specialist | `agentDb` / `agentDbFor(tx)` from `agent/lib/db.ts` |

---

## 5. Errors

Throw one of [`errors.ts`](./errors.ts). Do not invent a class with a status on
it, and do not return `{ ok: false }` from a command — a command that did not
write must throw.

| Situation | Throw |
| --- | --- |
| well-formed input the rule rejects | `DomainValidationError(message, field?)` |
| the caller may not | `DomainAuthorizationError` |
| not there — or not there *for them* | `DomainNotFoundError` |
| the row moved under them | `DomainStaleVersionError` |
| the state machine has no such edge | `DomainTransitionError(message, from, to)` |
| a port failed | `DomainSideEffectError(message, port, retryable)` |

`message` is shown to an operator. It never carries another record's data, a
stack, or a raw database error. Write it as the sentence you would want to read
at 4pm on a Friday: "This variation was already approved." beats "Invalid
state".

Shape validation belongs to the transport — Zod at the Eve contract, the
route's schema — not to the command. The command rejects well-formed input the
*business* disagrees with.

---

## 6. Side effects

1. Take the capability as a port. Do not import the provider.
2. Decide and act in the same command. A command that returns "yes, this URL is
   in scope" and leaves an adapter to do the deleting cannot be tested for the
   case where it refused.
3. If a duplicate would cost something, record a durable intent first through
   [`outbox.ts`](./outbox.ts), and pick the idempotency key for **how long the
   effect stays the same**. A key with no time in it deduplicates for ever,
   which is how a re-invitation and a second reminder became permanent no-ops
   behind a success message.
4. `repeatable` is opt-in. Default is that an ambiguous failure waits for a
   human, because a duplicate customer email or invoice is the expensive
   outcome.
5. Use `runOutboxEffectWithOutcome` and **say** when a call was replayed.
   Answering "sent" for a replay tells the office an email went out when none
   did.
6. Post-commit work that only a request can do — `revalidateTag`, `after()`, a
   Xero call that must not roll back the write — is reported in the result and
   performed by the adapter. `UpdateMilestoneOutcome.stageClaim` is the worked
   example: the App raises the claim in `after()`, and Eve, which cannot reach
   Xero, tells the operator which stage is now owed instead of silently
   skipping it.

---

## 7. Moving one rule: the order that works

1. **Find every implementation.** Grep the operation, not the file name. Check
   `lib/data/*`, `agent/lib/*-operations.ts`, the route handler itself, and
   `lib/actions/*`. The inline copy in a route handler is the one that gets
   missed.
2. **Diff them.** Write down every place they disagree before choosing. Every
   phase of this migration found at least one divergence that was a live
   defect, and they were found at this step, not later.
3. **Write the command** with the stricter behaviour, in the right folder,
   taking `principal`, `input`, `db`.
4. **Point the App adapter at it**, keeping the exact response shape its screens
   read. Delete the old body — do not leave it beside the new one.
5. **Point the Eve specialist at it**, and lower its number in `BUDGET` in
   `tests/architecture/agent-operations-prisma.test.ts` in the same change. The
   ratchet only works if it stays tight.
6. **Map the refusal.** The route uses `domainErrorResponse`; a Server Action
   uses `domainActionFailure` or its own richer result. If you skip this, the
   operator gets a blank 500 and presses the button again.
7. **Write the test.** The command is Node-safe, so `recordingDb` from
   `tests/architecture/domain-harness.ts` can run it. Assert the refusal *and*
   that nothing was written: `assert.deepEqual(recorder.writes(), [])`.
8. **Record the move** in the ownership ledger at the bottom of
   `tmp/ISSUE-301-DOMAIN-MIGRATION-TODO.md`, and say whether the old
   implementation is deleted.
9. **Run the guards**: `npx tsc --noEmit`, then
   `tests/architecture/domain-boundary.test.ts`,
   `tests/architecture/agent-operations-prisma.test.ts`,
   `tests/architecture/domain-error-surfacing.test.ts`,
   `tests/agent/authored-package-boundary.test.ts`.

---

## 8. Things that look like they belong here and do not

- **`revalidateTag` / `cacheTag` / `cacheLife`.** Request-scoped Next concepts.
  A cron has no request. `lib/domain/leads/stage-sync.ts` exists because the
  rule could not be called from anywhere until the cache call was lifted out.
- **`after()`.** Same: there is no request to defer into. Report what happened
  in the result and let the adapter defer.
- **Clerk.** Authentication happens at the channel boundary — `currentPrincipal`
  in the app, `agent/lib/channel-auth.ts` for Eve — and a `DomainPrincipal`
  comes down.
- **A provider SDK.** `@vercel/blob`, `xero-node`, `@novu/api`, DocuSign,
  Microsoft Graph, the AI gateway. They arrive as ports.
- **`server-only`.** It throws outside a React bundler, so it makes the module
  unloadable by a test, a cron and Eve.
- **A barrel import** that reaches Next. `@/utils/validators` re-exports the
  route helpers, which import `next/server`. Import the leaf
  (`@/utils/validators/lead`, `@/utils/validators/activityLog`).
- **React view models.** A command returns a domain record; the page shapes it.
- **A port with no domain caller.** Dead code with a plausible name is worse
  than no code. Add the port in the change that needs it.

---

## 9. The guards, and what each one catches

| Test | Catches |
| --- | --- |
| `tests/architecture/domain-boundary.test.ts` | a `lib/domain` module reaching Next, Clerk-Next, React, Eve, `app/**` or `agent/**`, with the import chain |
| `tests/architecture/agent-operations-prisma.test.ts` | an Eve specialist gaining direct business Prisma, and a budget left slack |
| `tests/architecture/domain-error-surfacing.test.ts` | an adapter that catches a domain refusal and answers with a 500 of its own |
| `tests/architecture/domain-outbox-coverage.test.ts` | an `OutboxEventKind` nothing produces; an `OutboxEvent` written by hand |
| `tests/architecture/test-suite-loadable.test.ts` | a test importing a module that transitively reaches `server-only` |
| `tests/agent/authored-package-boundary.test.ts` | authored agent code reaching a package Node cannot load |
| `tests/security/use-server-auth.test.ts` | a Server Action with no caller check, and a stale allowlist entry |

Each of these has a self-check that proves it can still see a planted
violation. If you change one, keep that.
