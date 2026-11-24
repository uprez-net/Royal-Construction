# Eve turn speed: what costs time, and what to measure next

From the 24 Nov 2026 production probe (#619, part of #622). Root turns took a
median 42 s and a 90th percentile of 81 s. Cost is not the problem: all
production use so far is $3.64.

## Final-output retries: now recorded

19 of 148 specialist turns took three or four model steps after their last
tool result instead of two. In each, eve refused the `final_output` call
against the output schema and asked again, which cost 17–39 s against the
usual 6–9 s. eve keeps `final_output` out of its action events, so the log
never said why.

The persistence hook now rebuilds each attempt from its streamed
`action.input.appended` deltas, checks it against `specialistResultSchema`,
and writes one `diagnostic.final_output_invalid` row on the specialist's
session for an attempt that fails (`agent/lib/final-output-diagnostics.ts`).
The row holds the field path, the Zod issue code and the message. It never
holds the value. It is not a hydratable event and is written only on
specialist sessions, which the workspace never hydrates.

To see which fields fail, once a few days have run:

```sql
SELECT issue->>'path' AS path, issue->>'code' AS code, count(*)
FROM "AgentSessionEvent" e,
     jsonb_array_elements(e.payload->'issues') AS issue
WHERE e."eventType" = 'diagnostic.final_output_invalid'
GROUP BY 1, 2
ORDER BY 3 DESC;
```

Then simplify the fields at the top of that list. The check uses the same Zod
schema eve lowers to JSON Schema, so it should agree with eve. A row whose
attempt eve accepted would point at a difference between the two.

## Skill loads: removed

31 of 77 specialist turns called `load_skill` two or three times before doing
any work, about a second of model time each. Every specialist now carries
its procedures (`instructions/procedures.ts`, what used to be the small
markdown skills) and the office handbook (`instructions/handbook.ts`) as
static instructions, and `load_skill` is disabled like the other unused
defaults (`tests/support/eve-default-tools.ts`). The handbook is about 9 KB.
Being static, it sits in the cached prefix and costs $0.02 per million tokens
on a cache hit, against a model round trip per load.

## Prompt cache: the prefix is now stable first

The cached share of input tokens fell from 54% on `zai/glm-5.3-flash` to 38%
on `openai/gpt-6-luna-fast`. eve composes the agent's `instructions.md`, then
the `instructions/` directory in filename order, and a provider reuses only
an unchanged prefix. Two things were in the way:

- **Skill announcements** live in user-role history and are re-appended when
  the advertised set changes. They are gone with the skills.
- **The cancelled-approval instruction** is per turn and used to sort first
  (`cancelled-approval.ts`). It is now `turn-cancelled-approval.ts`, after the
  static handbook, house style and procedures. Each specialist's order is now
  `handbook`, `house-style`, `procedures` (all static), then `sydney-clock`
  and `turn-cancelled-approval` (per turn).

The orchestrator's order was already stable first: `office-handbook`, then
`office-snapshot` (changes nightly), `pending-approvals` (changes only when
the list of waiting approvals does) and `sydney-clock` (every turn).

Whether the remaining gap is the provider's caching (minimum prefix length,
how it buckets prefixes) and not our prompt is not settled. Compare
`cachedInputTokens / inputTokens` per specialist before and after this
change, at the next probe.

## The tail after a specialist finishes: not changed

From the last `subagent.completed` to the `delegate` result took a median of
2.0 s, but 19 s at the 90th percentile. The `delegate` tool is a workflow
(`"use workflow"`). Once the specialist's step is recorded, the workflow body
has to be resumed to judge the result and return it. That resumption goes
through the workflow runtime's queue, and a cold function on that path is the
likely cause of the slow tail. Nothing in `delegate` itself does slow work
after the specialist returns: `judgeSpecialistResult` is pure, and the
read-only retry starts a new specialist (its own `subagent.called`), so it
would not be counted in this gap.

To confirm, at the next probe compare that gap with the gap between the
`subagent.completed` event's `occurredAt` and the next workflow step's start
in the Vercel Workflow run for the same delegate, and look for cold starts on
the workflow route in the function logs at those times.
