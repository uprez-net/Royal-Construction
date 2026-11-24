# The Eve event log (`AgentSessionEvent`): what it holds and how to read it

The application keeps its own copy of eve's stream, written by the `*` hook
(`agent/lib/event-persistence.ts`). It feeds the conversation list, the
reload of an open conversation, approvals that are still waiting, and every
production probe. Notes from the 24 Nov 2026 probe (#620, part of #622).

## Streaming deltas are kept, deliberately

`message.appended`, `reasoning.appended` and `action.input.appended` make up
about 45k of the 53k rows (13.6 MB of a 65 MB table), and the `*.completed`,
`actions.requested` and `action.result` events repeat their content. They are
still kept, because pruning them would break the reload:

- The workspace hands eve the stored events as `initialEvents` and then
  replays the live stream **from index 0** (`streamIndex: 0` in
  `components/agent/agent-workspace.tsx`). eve drops a replayed event only if
  it has already seen that event's `meta.id`.
- A conversation stored without its deltas would paint from the completed
  events. The live replay would then re-admit every delta it had never seen
  and append it to text that the completed event had already built. Every
  message would read twice.
- `action.input.appended` is also what the final-output diagnostic reads
  (`docs/eve-turn-speed.md`).

At the current rate (about 65 MB in seven weeks) the table grows by roughly
half a gigabyte a year. If that becomes a problem, the safe thing to prune is
**specialist (child) sessions' deltas** for turns that ended more than 30 days
ago. The workspace never hydrates a child session, so nothing replays them.
Root sessions' deltas stay as long as the conversation can be opened.

## Things to know when querying it

- **`occurredAt` is a timestamp without time zone**, written in UTC. Run the
  client in UTC, or every duration across a daylight-saving change is off by
  an hour.
- **Skill loads had no `toolName`.** Their `actions.requested` entries carried
  `kind: "load-skill"`, so a query grouping by `toolName` showed them as null.
  Specialists no longer load skills (#619), so this only affects history
  before 25 Nov 2026.
- **`approval.settled` carries `turnId: ""`.** The workspace clears the
  pending approval by its request id, and eve's own projection finds the card
  by approval id, so the empty turn id is harmless
  (`tests/agent/transcript-reducer.test.ts` pins both).
- **Rows that are not eve events:** a payload Postgres refused is stored as an
  `{ omitted: true }` marker (#615), and a refused specialist answer as a
  `diagnostic.final_output_invalid` row (#619). Neither has a `meta`, so the
  reload stops before one rather than replaying it.
- **Specialist sessions** read `COMPLETED` once their turn completes (#617);
  rows written before 25 Nov 2026 still read `WAITING`.

## Baseline: write lag

From `occurredAt` (eve's clock) to `createdAt` (the row's insert): 0.09 s at
the median, 0.56 s at the 90th percentile, 0.76 s at the 99th, and 3 s at
most. This is the baseline after the buffered writes of #429. No action
needed.

## `get_project` output

`get_project` failed its own output schema 42 times between 22 Oct and 13
Nov, on a JavaScript `Date` in `data.project.lead.emails[].sentAt`. It has not
failed since 14 Nov. A test now runs `get_project`'s output for a lead with
emails through the tool's own output schema
(`tests/agent/project-detail-envelope.test.ts`).
