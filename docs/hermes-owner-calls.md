# Hermes owner calls

Hermes is the business owner's personal assistant. It runs on its own server.
It can ask Mili, Royal's voice agent, to **ring the owner's own phone and
brief them by voice**, now or at a scheduled time. If the owner asks
something the briefing doesn't cover, Mili offers them the choice: **hold**
(with music) while she asks Hermes, or **a call back** with the details.
When the call ends, Royal sends Hermes a **post-call handoff** with what the
owner asked for, and Hermes schedules the callback. Every call is recorded,
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
         "hold, or a call back?" ──┬── hold: music ── call desk: ask_hermes
                                   │       ──▶ Hermes /v1/chat/completions
                                   └── call back: hand_to_hermes (noted now)
      call ends ──▶ OwnerCallHandoff: PENDING ──▶ workflow ──▶ Hermes
                                   /v1/chat/completions (the handoff)
Hermes ── schedule_owner_call(handoff_id) ──▶ the callback; handoff RESOLVED
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
   `HERMES_SERVER_MCP_URL` to the base URL of Hermes's API server (no username or
   password in it) and `HERMES_SERVER_MCP_TOKEN` to that server's API key.
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
| `schedule_owner_call` | Rings now, or at `call_at`. Takes `idempotency_key`, `category`, `subject`, `agenda`, `context`, `reference`, `event_at`, `call_at` and, for a callback, `handoff_id`. The same key never rings twice, and a handoff gets one callback. Use a new `idempotency_key` for every callback, including a replacement for one that didn't reach the owner; reuse a key only to retry the same request. A key already used for a different call is refused. |
| `get_owner_call`      | Where a call stands: `scheduled`, `placing`, `placed`, `canceled` or `failed` (with `failure_reason`). Once placed, it also gives the call's status, whether the owner answered, how long it ran, the transcript, whether the recording was saved, and its `handoff`. |
| `cancel_owner_call`   | Cancels a call before it rings. Refused once it has rung. |
| `list_owner_calls`    | The calls still to ring, then the most recent ones. |
| `list_owner_call_handoffs` | The post-call handoffs still outstanding, oldest first, including ones Royal could not deliver. Up to 50 a page; pass `cursor` (the `next_cursor` from the page before) for the next. |
| `get_owner_call_handoff` | One handoff: the call, whether the owner picked up, each request, the transcript, and where it stands. |
| `resolve_owner_call_handoff` | Marks a handoff dealt with when no callback is needed, with one line saying how. |

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
`Authorization: Bearer <HERMES_SERVER_MCP_TOKEN>`:

```
POST <HERMES_SERVER_MCP_URL>/v1/chat/completions
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
`choices[0].message.content`. The owner is holding, with music, so Hermes
should answer quickly, in two or three short sentences of plain text. Royal
waits up to 45 seconds for the response, and Mili waits 50 seconds at most.
These all become "Hermes will call you back with that", with the question
noted on the handoff:

- a response that isn't a chat completion
- an empty answer
- a timeout
- a non-2xx response

A call can ask up to eight questions. Failures are reported to Sentry as
`vendor: hermes`.

## Hold, or a call back

A question only Hermes can answer can take a while, so Mili never asks
straight away. She says: *"I'll need to check that with Hermes, which can
take a minute. Would you like to hold, or shall I have Hermes call you back
with the details?"* (Without Hermes connected she offers the call back
only.)

- **Hold.** She says "one moment", and the call desk runs `ask_hermes`. Music
  plays from the moment her words have finished until the answer is back
  (`lib/comms/voice-agent/session.ts`). Her silence isn't sent while it
  plays, and if she speaks, the music queued ahead of her is dropped with
  the carrier's `clear` event. The owner holds for up to 50 seconds. If
  Hermes fails or is slower than that, she tells them Hermes will call back,
  and the question is noted as a callback request (`source: hold_failed`).
  If that can't be noted either, she says so and promises nothing.
- **A call back.** She confirms Hermes will call back. She never suggests a
  time, and repeats one only if the owner gave it. The desk runs
  `hand_to_hermes`, which writes the request to the call's handoff at once,
  so it outlives a session that dies mid-call. Something the owner asks to
  have *done* (book, send, remind) is noted the same way, without
  `call_back`.

The music is 30 seconds of James Scott's *Don't Jazz Me Rag* (1921). It
comes from a public-domain piano recording on Wikimedia Commons, and the
piece is out of copyright in Australia as well. It's stored as 8 kHz μ-law
in `assets/voice-agent/hold-music.ulaw`, and `next.config.ts` ships it with
the voice-agent route. `lib/comms/voice-agent/hold-music.ts` has the ffmpeg
line that made it. If it can't be read, the owner holds in silence, and that
is reported.

## The post-call handoff

When an owner call ends, Royal passes Hermes what it left
(`lib/domain/comms/calls/owner-call-handoff.ts`):

1. **The call ends.** Mili's report or the carrier's last status, whichever
   lands first, marks the call's `OwnerCallHandoff` `PENDING`. There is one
   handoff per owner call, so a repeated event does nothing. Unanswered
   calls get one too, so Hermes knows the briefing wasn't given. A callback
   that rang out unanswered doesn't get its own: the handoff it came from
   is reopened instead. Calls placed before handoffs existed never get one.
2. **Delivery.** A workflow (`lib/workflow/owner-call-handoff.ts`) sends one
   chat completion to Hermes's API server. The system message holds Royal's
   rules and the handoff id. The user message holds the call as data: its
   outcome, each request (with `call_back` and the owner's own timing
   words), and the transcript. An answered call with no transcript yet waits
   up to 5 minutes for the recording's, then goes without and says so. The
   handoff is claimed `PENDING → DELIVERING` under a fresh claim id, and
   the result is written only while that claim still holds. So two runs
   never both send it, and a stale attempt never overwrites a newer one.
   The requests are read after the claim, so one noted just before it goes
   in. Hermes may take up to 3 minutes to reply. A 2xx chat completion makes
   it `DELIVERED`, and the reply is kept.
3. **Hermes deals with it.** For a callback, Hermes calls
   `schedule_owner_call` with `handoff_id` once it has the answer and the
   call has ended. Until then the handoff is still open and the request is
   refused, with a reply telling Hermes to wait for the handoff. Scheduling
   resolves the handoff in the same transaction, under the handoff's row
   lock. A handoff already resolved without a callback is refused one. Hermes then reads the call
   back with `get_owner_call`. A second request for the same handoff returns
   the first callback, so a handoff Hermes received twice still rings once.
   If nothing needs a callback, Hermes calls `resolve_owner_call_handoff`.
   If the request or the timing is unclear, Hermes asks the owner on its own
   channels. Royal never decides a callback time.
4. **Failures stay outstanding.** A failed delivery is `FAILED`, with the
   reason, reported as `vendor: hermes`, operation `handoff`. The workflow
   retries after 1, 5 and 15 minutes. After that, the hourly
   `/api/cron/owner-calls` backstop retries it, up to 12 tries in all. It
   also re-starts a run that was lost, and marks a call that ended with
   neither end event recorded, and fails a delivery that was cut off with
   no tries left. Without `HERMES_SERVER_MCP_URL`, delivery
   stops at once and the handoff waits for Hermes to pull it with
   `list_owner_call_handoffs`. A callback that fails to ring (missed, no
   owner line, the carrier refused, or it rang out unanswered) reopens its
   handoff and unlinks it, so Hermes can schedule another. A callback whose
   carrier answer was uncertain may have rung, so it stays linked until
   someone checks the carrier's log. The admin hub shows *"N need attention"*
   (not passed on, or taken but never acted on). Agent calls lists those calls at the top, however old they
   are, and each call there shows its handoff.
5. **Reopened, not replayed.** A handoff is reopened (back to `PENDING`, its
   `revision` bumped) when its callback didn't reach the owner, or when a
   request is noted after it was sent. For example, the owner hangs up while
   holding and the "Hermes will call back" note lands late. Each delivery
   names its revision. Revision 0 sent twice is a replay, and Hermes is told
   not to redo it. A higher revision is new, and Hermes is told to act on it.
   The same request noted again with a different callback choice or time
   keeps the latest. Notes on a handoff are admitted one at a time.
6. **`DELIVERED` is not "done".** A 2xx reply only means Hermes answered, so
   Royal checks what Hermes actually did.
   - **The RESULT line.** Hermes ends its reply with `RESULT: scheduled`,
     `RESULT: resolved`, `RESULT: needs_owner` or `RESULT: cannot` (the last
     marker counts). `needs_owner` or `cannot` fails the handoff at once with
     no automatic retry, since it would only say the same, and it is reported.
     A reply with no marker is judged by the check below.
   - **The check.** Ten minutes after delivery the workflow looks again. Still
     unresolved, it reopens the handoff once (a new revision saying "you
     replied but did not schedule a callback or resolve it") and delivers it
     again. Ten minutes after that, still unresolved, it is `FAILED`, with no
     automatic retry, and reported. The hourly backstop fails any `DELIVERED`
     handoff 45 minutes old and unresolved, for a run that was lost. Every one
     of these shows under Admin → Agent calls, and its `console.error` reaches
     the office inbox.
   - **A call where the owner said nothing.** An answered call of 45 seconds
     or less with no noted request and no line from anyone but Mili in the
     transcript is closed (`RESOLVED`, "nothing was asked") and Hermes is not
     asked. A longer call like that is probably a lost transcript, not a
     silent owner, so it is still sent, with a note telling Hermes not to
     guess and to end with `RESULT: needs_owner`, which fails the handoff and
     reports it so the office asks the owner. Mili's own labelled live
     transcript must exist and, with the recording's (also labelled), show no
     one but Mili: a recording alone, which may have no speaker labels, never
     closes a call, and a voicemail greeting in the recording counts as a
     caller line. A reopened revision is always sent.
   - **Two transcripts.** The voice model's live transcript can drop a short
     reply or mishear one ("10 minutes" came out as "tomorrow" on a real
     call), while the recording's speech-to-text got both right. When both
     exist and differ, Hermes is given both, the recording first, and the
     workflow waits 45 seconds after hangup before the first send so the
     recording's transcript has landed.

## What the owner hears

The owner never hears the name Hermes. Everything Mili is given to say, and
everything the call desk compares against what she said, calls the assistant
"Agent Factory" (`lib/domain/comms/calls/voice-agent-owner-call.ts`;
`tests/comms/owner-call-spoken-name.test.ts` fails if "Hermes" returns to it).
Tool names (`ask_hermes`, `hand_to_hermes`) stay, since they are never spoken.
Hermes is told not to write its own name in the subject, agenda or context,
and so is Eve's `schedule_owner_call` tool description. If the owner gives two
times ("tomorrow, or in five minutes"), Mili asks which they want.

## The event log

Each step is stored as an `AgentCallEvent`:

- scheduled, placed, waiting, failed or cancelled
- each lookup and question to Hermes, with its arguments, its answer and how
  long it took (and whether the owner held for it)
- each request noted for Hermes, and the handoff: ready, delivered, failed,
  resolved, or reopened by a failed callback
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
| Post-call handoff | `lib/domain/comms/calls/owner-call-handoff.ts`, `lib/workflow/owner-call-handoff.ts`, `lib/comms/owner-call-handoffs.ts` |
| Hold music | `lib/comms/voice-agent/hold-music.ts`, `assets/voice-agent/hold-music.ulaw` |
| Admin page | `app/(main)/admin/agent-calls/page.tsx`, `components/admin/agent-calls-panel.tsx` |
