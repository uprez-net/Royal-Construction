# Hermes owner calls

Hermes is the business owner's personal assistant. It runs on its own server.
It can ask Mili, Royal's voice agent, to **ring the owner's own phone and
brief them by voice**, now or at a scheduled time. If the owner asks
something the briefing doesn't cover, Mili passes the question back to
Hermes on the call and reads out the answer. Every call is recorded,
transcribed and logged, and the office sees all of it under
**Admin → Agent calls**.

```
Hermes ── Eve MCP (/eve/v1/mcp) + X-Hermes-Secret ──▶ schedule_owner_call
                                                       │ OwnerCall: SCHEDULED
             now ──────────────────────────────────────┤
             later: timer (durable sleep, no polling) ─┘
                                                       ▼ rings the owner line
      owner answers ──▶ flow.ts: connectAgent (recorded, up to 15 min) ──▶ Mili
                                                       │ "let me check that"
Hermes API server ◀── /v1/chat/completions ── call desk: ask_hermes
Hermes ── get_owner_call ──▶ status, answered?, transcript, recording saved?
```

## Setting it up

1. **Owner line.** Under Admin → Phone & SMS → *Owner line*, enter the
   owner's first name (Mili greets them by it) and their own mobile. It can't
   be one of the business numbers. These calls can only ever ring this one
   number: Hermes decides what Mili says, never who she rings.
2. **Hermes → Royal.** Hermes connects to the operations agent's MCP endpoint
   (`/eve/v1/mcp`) as any MCP client does, signed in through Clerk as an
   office user (see [eve-mcp-endpoint.md](./eve-mcp-endpoint.md)). It also
   sends the `X-Hermes-Secret` header, set to `HERMES_MCP_SECRET` (32+ random
   characters, `openssl rand -hex 32`, set in both places). That header marks
   the session as Hermes's, and only such a session is offered the four
   owner-call tools. Anyone else signed in through the same channel never
   sees them.
3. **Royal → Hermes** (optional, for follow-up questions). Set
   `HERMES_SERVER_URL` to the base URL of Hermes's API server (no username or
   password in it) and `HERMES_SERVER_TOKEN` to that server's API key.
   Without these, Mili answers from the briefing only and says Hermes will
   follow up. Plain `http://` to the server's IP is accepted because Hermes
   has no domain yet, but the key and the owner's questions then travel
   unencrypted, and the admin comms panel says so. Switch to `https://` once
   Hermes has a domain.
4. **Mili** must be on: `COMMS_AGENT_ENABLED`, `COMMS_AGENT_SECRET` and
   `COMMS_CALLS_ENABLED`. If she's off, a request is refused and the refusal
   says so.
5. **Function duration.** Owner calls run for up to 15 minutes, so the
   voice-agent route sets `maxDuration = 1000`. Anything above 800 s needs
   Vercel Pro with the extended-duration beta, set per function, as it is
   here.

## The tools, on the Eve MCP channel

Hermes sends natural language to `agent_start`, for example "Call Raj at
9:15 tomorrow to remind him about the Smith St inspection: …". The
orchestrator calls these tools directly, without delegating:

| Tool                  | What it does |
| --------------------- | ------------ |
| `schedule_owner_call` | Rings now, or at `call_at`. Takes `idempotency_key`, `category`, `subject`, `agenda`, `context`, `reference`, `event_at` and `call_at`. The same key never rings twice. |
| `get_owner_call`      | Where a call stands: `scheduled`, `placing`, `placed`, `canceled` or `failed` (with `failure_reason`). Once placed, it also gives the call's status, whether the owner answered, how long it ran, the transcript, and whether the recording was saved. |
| `cancel_owner_call`   | Cancels a call before it rings. Refused once it has rung. |
| `list_owner_calls`    | The calls still to ring, then the most recent ones. |

Limits:

- the subject: up to 160 characters
- the agenda: up to 12 points of up to 300 characters each
- the context: up to 12,000 characters
- `call_at`: up to 60 days ahead
- six owner calls an hour, and one at a time

A refusal (no owner line, Mili already on a call, a bad argument) comes back
as `{ ok: false, refusal }` in the domain's own words. The writes
(`schedule_owner_call`, `cancel_owner_call`) are audited like every other
agent write.

## How a scheduled call rings

A call for later gets a timer: a Vercel Workflow run that sleeps until
`call_at` and then rings. Nothing runs while it waits, so the database isn't
read once a minute for calls that are due. This is how it fits together:

- **Starting the timer.** Eve can't start the app's workflows itself, so the
  agent write's usual effects post (`/api/agent/effects`) starts the timer.
- **Backstop.** An hourly backstop (`/api/cron/owner-calls`, at :15 beside
  the approval-expiry cron, so it adds no database wake-ups) re-arms every
  call due within 70 minutes, in case a start was lost.
- **No double ring.** Two timers for one call are harmless: the call is
  claimed `SCHEDULED → PLACING` and rung under its own outbox key, so it
  rings once. A cancelled call is never claimed.
- **Mili busy.** If Mili is already on a call to the owner, or the hourly
  cap is reached, the timer retries every minute.
- **Missed.** A call more than **30 minutes late** for any reason is dropped
  as missed rather than rung late.

## How the call goes

- **Recorded, with no announcement.** It's the owner's own call, placed on
  their own assistant's request. The live transcript and the recording (with
  its own speech-to-text) are both kept.
- **Mili speaks first.** She opens with fixed words: the owner's name and the
  category. Then she covers the agenda and answers from the context. If the
  owner asks her to *do* something, she says she'll pass it to Hermes, and
  it's in the transcript.
- **Up to 15 minutes.** She's asked to wrap up 45 seconds before the end.
- **Nobody else is rung.** However the call ends, even if the owner asks for
  "the team", it hangs up.
- **CRM lookups.** These come along only when the owner line is a verified
  admin's phone and `COMMS_AGENT_DISCLOSURE_ENABLED` is on. It's the same
  rule as for an inbound call.
- **The briefing is data, not instructions.** Hermes builds it from email
  and calendar text that anyone could have written into, and Mili's
  instructions say so.

## Questions back to Hermes

When the owner asks something the briefing doesn't cover, Royal sends one
OpenAI-style chat completion to Hermes's API server, with
`Authorization: Bearer <HERMES_SERVER_TOKEN>`:

```
POST <HERMES_SERVER_URL>/v1/chat/completions
{
  "model": "hermes-agent",
  "stream": false,
  "messages": [
    { "role": "system", "content": "Royal Constructions' voice agent, Mili, is on a phone call with the owner … Royal's call id: … Your reference: task-9. … <briefing>Mili … is briefing Raj on: Smith St brief. …</briefing>" },
    { "role": "user", "content": "Who else is coming to the inspection?" }
  ]
}
```

The briefing goes in the system message, marked as data rather than
instructions, and Hermes is told to answer only, not to act. Royal reads
`choices[0].message.content`. Hermes should answer within about 20 seconds,
in two or three short sentences of plain text. These all reach the owner as
"I couldn't check that just now":

- a response that isn't a chat completion
- an empty answer
- a timeout
- a non-2xx response

A call can ask up to eight questions. Failures are reported to Sentry as
`vendor: hermes`.

## The event log

Each step is stored as an `AgentCallEvent`:

- scheduled, placed, waiting, failed or cancelled
- each lookup and question to Hermes, with its arguments, its answer and how
  long it took
- the desk ending the call
- how Mili's session ended

Events from the call itself are written **off the conversation's path**. The
session queues them and a writer stores them in batches every two seconds
(`lib/comms/voice-agent/event-writer.ts`), so a slow database never delays
what Mili says. The last batch lands before the function stops. This applies
to every call Mili takes, inbound ones included.

## Where the code is

| Piece | File |
| --- | --- |
| Owner line | `lib/domain/comms/owner-line.ts`, `components/admin/owner-line-card.tsx` |
| Requests, timer claim, cancel | `lib/domain/comms/calls/owner-call.ts` (rings through `placeStaffCall`) |
| Event log | `lib/domain/comms/calls/agent-events.ts`, `lib/comms/voice-agent/event-writer.ts` |
| Timer | `lib/workflow/owner-call.ts`, `lib/comms/owner-call-timers.ts`, `app/api/cron/owner-calls/route.ts` |
| Routing an answered call to Mili | `lib/domain/comms/calls/flow.ts` |
| What Mili says | `lib/domain/comms/calls/voice-agent-owner-call.ts` |
| Mili's setup for the call | `lib/comms/voice-agent/caller.ts` |
| Hermes's tools | `agent/tools/owner_calls.ts`, `agent/lib/owner-calls.ts`, `agent/lib/mcp-auth-policy.ts` |
| The client to Hermes | `lib/hermes/assistant.ts`, `lib/hermes/config.ts` |
| Admin page | `app/(main)/admin/agent-calls/page.tsx`, `components/admin/agent-calls-panel.tsx` |
