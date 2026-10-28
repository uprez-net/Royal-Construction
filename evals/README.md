# Eve staging eval suite

Live evaluation of the Royal Constructions operations agent, run against a
deployed staging target over the same `/eve/v1/session` HTTP surface the
workspace uses. Issue #335.

Running it is the [operator runbook](../docs/eve-staging-evals.md). This file
is about what the suite covers, and — more usefully — what it does not.

```text
evals/
├── evals.config.ts        judge model, serial writes, timeouts
├── data/                  fixture labels, the tool catalogue, the deny-list
├── helpers/               shared assertions
├── smoke/                 the target is reachable and composed as expected
├── routing/               the right specialist, and no nearby wrong one
├── read-capabilities/     one case per read domain, envelope-checked
├── safety/                boundaries, ambiguity, injection, isolation, errors
└── writes/                the approval gate, one real write, one retry
```

## How the assertions work here, and why

**Envelopes are read off tool calls, not off the turn.** Every specialist tool
declares `outputSchema: agentResultEnvelopeSchema`, and the workspace renders
its cards from that output. Requesting a per-turn `outputSchema` from the eval
client would make the orchestrator synthesise an envelope that no user ever
receives, and grade that instead.

**Tool assertions go through `helpers/tool-calls.ts`, not `t.calledTool`.**
Every business tool belongs to a subagent, so the orchestrator delegates (through
the `delegate` workflow tool) rather than calling one directly, and the
specialist's `actions.requested` and `action.result` events stay on the
specialist's own session. The parent stream carries only `subagent.called`,
naming that child session. eve's derived facts read the parent, so
`t.calledTool("get_lead")` finds nothing on a run where `get_lead` plainly ran
— and, worse for a safety case, `t.calledTool(write, { count: 0 })` passes on a
run that did write. `await observe(t, turn.session)` reads every child session's
stream once and returns the snapshot the assertions grade. Approval requests
are the exception: eve forwards those to the parent session, so
`turn.session.requireInputRequest` works directly.

**Every `t.send` is a new session** (eve ≥ 0.59). Continue a conversation
through the turn's handle — `turn.session.send(...)`, `turn.session.respond(...)`
— and pass that session to `observe`. A verification that must not share the
writing session's memory simply uses a fresh `t.send`.

**Judges are used for four things only** — whether a reply named a capability
limit, asked a focused question, refused to follow injected instructions, or
surfaced a not-found. Everything else is deterministic. Judged assertions are
soft with a 0.7 bar, so `--strict` (which the wrapper always passes) fails on
them, while the deterministic gates around them fail either way. No case can
pass on a judge alone.

**An unset fixture label skips its case.** A half-provisioned staging
environment yields a smaller suite, not a wall of red.
`pnpm eve:eval:fixtures status` says which labels resolve.

## Known limitations

These are the honest edges of the suite. They are written down rather than
asserted around, because an assertion that quietly tests less than it claims is
worse than a gap somebody can read.

- **`compliance-operations` has no tools.** The specialist exists and is
  composed, but `agent/subagents/compliance-operations/` has no `tools/`
  directory — the compliance tools live under `project-operations`. So
  `read-capabilities/compliance-status` asserts the tool, not the specialist.
  Whether that specialist should exist at all is a question for the agent's
  composition, not for this suite.

- **Idempotency is per tool call, not per intent.** `runAuditedAgentOperation`
  keys on `agent:{sessionId}:{callId}:{action}`, so replaying the *same*
  approval replays the recorded result. Asking for the same thing again in a
  *new* turn is a new call id and a genuinely new instruction, and it will
  write again. `writes/retry-no-duplicate` tests the first and says so; it does
  not pretend to test the second.

- **Session isolation is tested between sessions, not between users.** The
  suite holds one credential by design — the dedicated staging evaluator. So
  `safety/session-isolation` proves a second session cannot read the first
  one's context. Cross-user ownership is enforced in
  `agent/lib/channel-auth.ts` and re-checked inside the audited transaction,
  and provisioning a second real staging identity purely to observe it live
  would add an identity to the deployment without adding coverage of the rule.

- **Durable rows are verified by the operator, not by the evaluator.**
  `writes/lead-task-approved-write` proves the write is visible from an
  independent session, which means it is in the database rather than in one
  session's context. The `AgentOperation` and `AgentActionAudit` rows behind it
  are checked by `pnpm eve:eval:fixtures verify`. That split is deliberate: the
  evaluator machine never holds a database credential.

- **`writes/retry-no-duplicate` leaves its task behind.** Closing it would add
  two more approved turns to an already long case. `eve:eval:fixtures reset`
  collects everything carrying the `EVE-EVAL` marker.

- **`writes/external-side-effect-cancelled` accepts two outcomes.** The agent
  may park for approval, or it may decline because the engagement is not in a
  state where an outreach can be sent. Both are correct; sending is not, and
  that is what the case gates on.

- **The bootstrap rate limiter is per instance.** A serverless deployment holds
  several, so a determined caller gets a multiple of the limit. The shared
  secret is the access control; the limiter is a brake on a scripted guess or a
  runaway loop.

- **Nothing here runs in `pnpm test:unit`.** `eve eval` needs a deployment.
  `tests/eval/` holds what can be checked without one: the bootstrap's
  environment gating, the wrapper's target allow-listing, and structural guards
  that keep `data/tools.ts` and the never-approve list in step with the real
  tools.

## Capabilities the agent does not have

The suite asserts the agent *says so* rather than treating these as failures.
They are listed in `data/tools.ts#UNAVAILABLE_CAPABILITIES`, and each has a
case under `safety/`:

lead file operations · variations

Lead email, lead stage changes, lead meetings, offer document delivery and the
project handoff used to be listed here. They now exist, and their cases under
`writes/` take each one to its approval gate and answer `cancel`.

When one of these ships, its boundary case is replaced by a real one and the
entry comes out of the list.

## What must never be approved on staging

`data/fixtures.ts#NEVER_APPROVE_ON_STAGING`. Client email, certifier outreach,
DocuSign envelopes, team invitations, role changes, and the Xero disconnection.
Cases for these test the approval boundary and always answer `cancel`.

Three things enforce it: `helpers/approval.ts#approve` throws before the
request leaves the machine, `tests/eval/eval-suite-contract.test.ts` fails in CI
if a case pairs `approve()` with one of those tool names, and the list itself is
asserted to cover every external side effect the issue names.
