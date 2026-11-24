# Eve approvals: batches, expiry and what a late approval can touch

Every Eve write that changes a record, sends something or costs money waits
for the session owner's approval (`ownerOnlyApproval` in
`agent/lib/agent-approval.ts`). This note covers how that wait behaves, from
the 24 Nov 2026 production probe (#622).

## A step's approvals resolve together (#616)

eve resumes a step only once **every** approval in it has an answer
(`findAnsweredApprovalBatches` in the installed eve;
`tests/agent/approval-batch-eve.test.ts` pins it). Approving one of five runs
nothing until the other four are approved or cancelled. An approved call still
runs when its siblings are cancelled.

- The workspace groups a step's approvals. The first waiting card carries
  **Approve all** and **Cancel all**. Approve all is withheld when the step
  holds an email or a WhatsApp message: those are read and approved one at a
  time.
- An approved card whose siblings are still waiting says so ("Approved: runs
  once the other 4 changes are answered"), not "Applying".
- `update_milestones` changes several milestones on one project in one call:
  one approval, one audit row, all or nothing. The project specialist is told
  to use it whenever more than one milestone changes.

## An unanswered approval expires (#617)

An approval is answerable until **the end of the next Sydney working day**
after it was asked for (`lib/domain/agent/approval-expiry.ts`; public holidays
are not counted out, which only ever shortens it).

- **The cron** `/api/cron/agent-approval-expiry` (hourly at :15) finds every
  approval past its deadline (`listPendingAgentApprovals`) and withdraws it
  through eve, as a Cancel on the conversation. Only once eve accepts is an
  `AgentActionAudit` row written (`action: "agent.approval.expired"`,
  `targetType: "agent-approval"`, `targetId: <requestId>`). A conversation eve
  refuses is retried next run and fails the run's monitor check-in.
- **The specialist** sees the cancellation, finds the audit row for that
  request, and ends with "Not done — the approval expired". `delegate` fixes
  the wording the office reads (`cancelledChangeResult`).
- **A late approval** given after the deadline but before the cron runs is
  refused by the response policy, with the deadline in the reason.
- **What shows it:** the approval card shows the deadline and, past it, no
  Approve button. The conversation list shows "Approval waiting · expires …".
  Every orchestrator turn is told about approvals waiting in the caller's
  other conversations (`agent/instructions/pending-approvals.ts`), so a brief
  mentions them.

### The one service request Eve accepts without a sign-in

The cron has no Clerk session. `agent/lib/channel-auth.ts` accepts exactly one
request without one: a `POST /eve/v1/session/<id>` carrying the
`x-guri-service: approval-expiry` header, the deployment's internal bearer
(`AGENT_EFFECTS_SECRET`, else `CRON_SECRET`), and a body that only cancels
pending requests (`lib/agent/approval-expiry-wire.ts`). Anything else that
claims to be the service is refused, not tried as a sign-in. It cannot send a
message, and it cannot approve: the response policy accepts only the session
owner.

### A batch half approved when it expires

eve keeps an approval already given while its siblings waited. When the
siblings expire and are cancelled, that approved call runs. That was the
person's decision; `update_milestones` makes such batches rare.

## Does a late approval re-check the record?

Expiry bounds how late an approval can be. Separately, these approval-gated
tools carry an optimistic-concurrency check of their own, so even an approval
inside the window cannot overwrite a newer edit:

| Tool | Check |
| --- | --- |
| `transition_offer_status`, `update_offer_details` | `expectedStateVersion` |
| `update_admin_content` | `expectedVersion` |
| `update_project_requirements` | `expectedUpdatedAt` |
| `set_activity_price` | `expectedPrice` |
| `update_build_sequence` | `revision` |

Milestones, leads, lead tasks, tradies, schedules, the other offer tools
(`create_offer_revision`, `save_contract_particulars`, sending) and compliance
have **no** version check: an approved change applies to the record as it is when it runs, within
the expiry window. Adding one means a version column or an `updatedAt`
comparison in each domain command; it is not done yet.

## Status

- A conversation parked on an approval shows as waiting for approval in the
  list, derived from the approvals themselves rather than a new status value.
- A specialist session is marked `COMPLETED` when its turn completes; one
  parked on an approval stays `WAITING`. Rows written before this change are
  not backfilled.

## Not yet reproduced

The 24 Nov 02:21 UTC case: the operator gave up on a `create_offer_revision`
approval within 80 seconds and asked again. That delegation used the
`goal` + `readOnly: false` + `sharedContext` form; the retry that worked used
`specialist` + `request`. Nothing in the reducer depends on the delegate's
input shape, so the cause is not known. It needs reproducing on staging.
