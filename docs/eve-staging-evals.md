# Running the Eve staging evals

The operator runbook for the live evaluation suite in [`evals/`](../evals/).
What the suite covers, and where it stops, is in
[`evals/README.md`](../evals/README.md).

These cases drive a deployed staging target over the real `/eve/v1/session`
surface, with the real model and real Clerk authentication. They are not unit
tests: they cost money, they take minutes, and the `writes` tag creates and
closes real records in the staging database. Nothing here ever runs against
production, and the deployment gating below is what makes that a property of
the environment rather than of somebody remembering.

## The short version

```bash
# Read-only. Safe to run whenever.
STAGING_URL="https://<preview>.vercel.app" \
EVE_EVAL_AUTH_SECRET="<shared secret>" \
pnpm eve:eval:staging -- --tag read-only

# Everything, writes included. Deliberate.
pnpm eve:eval:staging

# Afterwards, from a machine that has the staging database credential:
pnpm eve:eval:fixtures verify
pnpm eve:eval:fixtures reset
```

`pnpm eve:eval:staging` always adds `--strict`, `--junit
.eve/staging-junit.xml` and `--max-concurrency 1`, and refuses to run if you
ask for concurrency above one. Everything else you pass — eval ids, `--tag`,
`--verbose` — is forwarded.

## Two machines, two halves

Keep these apart. It is the reason the flow is a wrapper and not a shell
variable.

| | Staging deployment | Evaluator machine |
|---|---|---|
| Holds | `CLERK_SECRET_KEY`, `EVE_EVAL_USER_ID`, the shared secret | the shared secret, the target URL |
| Does | mints a 5-minute Clerk session token for the eval user | proves it holds the secret, runs `eve eval` |

The developer machine never needs the Clerk secret key. Only the deployment can
mint a session, which is the whole point of putting the bootstrap route there.

A third, separate role — fixture maintenance — needs the staging **database**
credential and nothing else. The evaluator does not hold it, and the CI
workflow does not either.

## One-time setup

### 1. The dedicated Clerk eval user

Create a Clerk user that exists only for this. Confirm, in order:

1. it exists in Clerk;
2. the Clerk webhook has synced it to an application `User` row — the Eve
   channel maps the Clerk id to that row and refuses an unknown one;
3. its role is the one the fixture cases need.

Today everyone at Royal Constructions is an `ADMIN` on a shared login, so the
eval user being an `ADMIN` is a deliberate fixture choice, not evidence of role
isolation. Do not use a real person's account, and do not reuse the `DEV_AUTH`
defaults.

`pnpm eve:eval:fixtures status` prints the resolved user and fails loudly if
step 2 has not happened.

### 2. Staging deployment variables

```bash
EVE_EVAL_AUTH_ENABLED=true
EVE_EVAL_AUTH_SECRET=$(openssl rand -hex 32)
EVE_EVAL_USER_ID=user_...          # the Clerk id from step 1
EVE_EVAL_DATABASE_LABEL=royal-staging
EVE_EVAL_FIXTURE_VERSION=v1

EVE_OPERATIONS_AGENT_ENABLED=true
EVE_OPERATIONS_SPECIALISTS_ENABLED=true
```

`POST /api/eval/auth` additionally requires `VERCEL_ENV=preview`. That
condition cannot be satisfied on a production deployment however the others are
set, which is what makes "production has no enabled evaluator bootstrap" true
by construction. On production, and on any preview that has not opted in, the
route answers `404` — indistinguishable from one that does not exist.

### 3. Evaluator variables

```bash
EVE_EVAL_AUTH_SECRET=<the same secret>
STAGING_URL=https://<preview>.vercel.app
EVE_EVAL_EXPECTED_DATABASE_LABEL=royal-staging   # optional, recommended
EVE_EVAL_STAGING_HOST=staging.example            # only for a custom domain
```

Without `EVE_EVAL_STAGING_HOST` the wrapper accepts `*.vercel.app` targets
only. A custom hostname has to be named deliberately, so a typo cannot point a
write run at whatever happens to resolve.

### 4. Fixture labels

Each label is a string the agent is asked to resolve the way an operator would
type it. They live in the environment, not in the repository: a committed name
is a committed hint about a real record.

```bash
EVE_EVAL_LEAD_LABEL="Eve Eval Lead v1"
EVE_EVAL_WRITE_LEAD_LABEL="Eve Eval Disposable Lead v1"
EVE_EVAL_AMBIGUOUS_LEAD_QUERY="Eve Eval Ambiguous"
EVE_EVAL_OFFER_LABEL="..."
EVE_EVAL_PROJECT_LABEL="..."
EVE_EVAL_MILESTONE_PROJECT_LABEL="..."
EVE_EVAL_COMPLIANCE_PROJECT_LABEL="..."
EVE_EVAL_TRADIE_LABEL="..."
EVE_EVAL_SCHEDULE_TRADIE_LABEL="..."
```

Every label except the ambiguity query must resolve to exactly **one** record.
`EVE_EVAL_AMBIGUOUS_LEAD_QUERY` must match **two or more** — that is what the
clarification case is for. `pnpm eve:eval:fixtures status` checks both
conditions and exits non-zero when one is wrong.

An unset label skips the cases that need it, reported separately and without
affecting the exit code.

## The fixture contract

`EVE_EVAL_WRITE_LEAD_LABEL` names a lead that exists to be written to. It is
the only record the suite mutates. Everything else is read.

Every disposable record an eval creates carries the marker `EVE-EVAL-<run>`.
That marker is the cleanup handle and the verification handle: it makes "did
the write land" answerable without reading a date back, and it lets a reset
collect records from a run that timed out before its own cleanup.

```bash
# Needs the staging database credential, named explicitly:
export EVE_EVAL_FIXTURE_DATABASE_URL="postgresql://.../royal_staging"
export EVE_EVAL_USER_ID=user_...

pnpm eve:eval:fixtures status              # are the labels resolvable?
pnpm eve:eval:fixtures verify              # durable rows behind recent writes
pnpm eve:eval:fixtures reset               # collect what runs left behind
pnpm eve:eval:fixtures verify --hours 72   # widen the window
```

There is deliberately no fallback from `EVE_EVAL_FIXTURE_DATABASE_URL` to
`DATABASE_URL`. `DATABASE_URL` is whatever the shell happened to load, and
`reset` deletes rows; making the operator name the staging database is the
difference between a reset and an incident.

`verify` is the half of the write verification the evaluator cannot do: it
reads the `AgentOperation` and `AgentActionAudit` rows and fails if a succeeded
operation has no completed audit row.

`reset` deletes lead tasks carrying the marker (any age), plus the eval user's
agent operations, audit rows and agent sessions within the window. It never
matches on date alone, so a fixture record created by hand survives it.

## Never approved on staging

The suite must never complete these, however they are reached:

client emails · compliance outreach and follow-ups · DocuSign envelope
creation, sending or voiding · team invitations and revocations · role changes
· the Xero disconnection

Cases for them test the approval boundary and always answer `cancel`. Three
things enforce it: the `approve` helper throws before the request leaves the
machine, a CI test fails if a case pairs `approve()` with one of those tool
names, and the list is asserted to cover every operation named above.

A role change is on the list for a reason beyond it being external: with
everyone on one shared `ADMIN` login, demoting the last admin locks the
business out with nobody left who can undo it.

## CI

The `Eve staging evals` workflow is `workflow_dispatch` only, defaults to the
read-only suite, and serialises across branches. It never runs on a pull
request: every PR would mutate shared staging data and pay for a model run, and
a failure is usually "staging is misconfigured" or "the model moved" rather
than "this diff is wrong".

Artifacts — `.eve/evals/` and the JUnit file — are uploaded privately with a
seven-day retention. Transcripts and event streams carry staging CRM text, so
treat them as sensitive. No external reporter is configured: Braintrust and
anything like it stay out until data export is explicitly approved.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `HTTP 404` from the bootstrap | Route disabled: check `EVE_EVAL_AUTH_ENABLED`, `VERCEL_ENV=preview`, `EVE_EVAL_USER_ID` |
| `HTTP 401` from the bootstrap | `EVE_EVAL_AUTH_SECRET` does not match the deployment's |
| `EVE_OPERATIONS_AGENT_ENABLED is not true` | The agent is off on the target; every case would fail on `agent_disabled` |
| `The target host is not the configured staging host` | `EVE_EVAL_STAGING_HOST` is set and the URL does not match it exactly |
| `reports database "x", expected "y"` | The deployment is wired to a different database than you meant |
| Everything skipped | No fixture labels configured — run `eve:eval:fixtures status` |
| Every judged assertion fails | The judge model id does not resolve on your gateway; set `EVE_EVAL_JUDGE_MODEL` |
| `agent_session_access_denied` | The token belongs to a different user than the session's owner |

## Manual override

`EVE_EVAL_AUTH_TOKEN` still works as a bearer override for a Clerk session JWT
obtained some other way:

```bash
EVE_EVAL_AUTH_TOKEN="$TOKEN" pnpm exec eve eval \
  --strict --url "$STAGING_URL" --junit .eve/staging-junit.xml --max-concurrency 1
```

It is a fallback for debugging the wrapper itself, not the normal path. It
skips the target, database, fixture-version and feature-flag checks, so the
guard that stops a live write run reaching the wrong deployment is not there.
