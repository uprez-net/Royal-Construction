# SMS, phone calls and WhatsApp calling — runbook

How to switch on texting and calling for leads, on **Twilio** or **Telnyx**, and
WhatsApp calling through Meta. The design is in
[docs/twilio-plivo-comms](./twilio-plivo-comms/README.md) (files 01, 06 and 07);
this page is what to set up and check. `/admin/comms` shows the live
configuration, every misconfiguration the app found, and the exact webhook URLs
to paste into the carrier's console.

## What it does

| Feature | Behaviour |
| --- | --- |
| SMS | Text a lead from **Phone & SMS** on the lead page (or the lead list's Call button). Replies land on the lead; a number no lead has waits on `/admin/comms`. `STOP` opts the lead out at once; `START` opts back in. |
| Outbound calls | The carrier rings the lead first. When they answer they hear "Connecting you now" (or the recording question) and are put through to **your browser** (picked up automatically) or **a phone you pick** from the team's phones (added on `/admin/comms`; the office mobile is listed too). The lead sees the business number either way. A browser credential can only receive calls, so it can never dial anyone. |
| Inbound calls | Never ring a browser. The caller hears "this call is being recorded", then **Mili**, the voice agent, answers and takes a message (see below). If Mili is off or can't be reached, or the caller asks for a person, the office mobile rings, then voicemail. Mili's transcript and the recording land on the lead's call. |
| Project calls | Admins only (a site manager never sees them). The project header's **Call** button opens a floating dialer: the site manager, every owner on the contract and every connected tradie (on the project, booked on it, or on a milestone), each one press from a call, plus a keypad for any other number. Placed exactly like a lead call: the server rings them first, then your browser or the phone you pick. The number for a person is read from their record on the server, never sent by the browser. During a browser call the keypad sends touch-tones. Every call is on the project's **Communications → Calls** with who, their number, the recordings and the transcripts, and on the project's activity log. |
| Inbound calls → projects | `/api/cron/project-call-matching` runs every six hours. For each inbound call Mili or the voicemail took in the last fortnight, it finds the caller's projects from the carrier-provided number alone (the same matcher Mili uses), and a model reads the transcript to choose one of them, or none. An answer outside that list files nothing. With no transcript, the model is not asked: the call is filed only if the caller is on exactly one project; otherwise it stays unfiled and on the leads page's pending list. A matched call shows a call-icon count on the project's Communications tab until someone opens Calls, and leaves the leads page's pending list. A voicemail waits up to an hour for its transcript. |
| Calls from the team | A call to the business number from one of the team's own numbers (a staff member's phone on their account, a team phone on `/admin/comms`, or the office mobile) never waits on the leads page's Pending Calls/Messages. `/admin/comms` lists it under **Calls from the team** with the person's name and role. |
| Recording | Inbound: always, announced by the declaration (shown as "told it was recorded"). Outbound: off unless `COMMS_RECORDING_MODE=consented`, then the lead is told the call is recorded and staying on the line is consent (shown as "told it was recorded"); nobody is asked to press a key. Recordings and voicemails are copied to Blob storage and deleted at the carrier. |
| WhatsApp calls | Customers' WhatsApp calls ring the browser dock; staff can call a lead who tapped **Allow calls** (asked from the WhatsApp chat's **Ask to call** button, inside the 24-hour window). WhatsApp calls cannot go to a phone. |

Everything external is behind the outbox: a double click or a retry never
texts or rings a customer twice, and an unconfirmed send is flagged for a
person rather than retried.

## Switching carrier

1. Set `COMMUNICATIONS_PROVIDER=twilio|telnyx`, that carrier's credentials and
   its number in `COMMS_PHONE_NUMBERS` (`<E.164>=<carrier>=<label>`).
2. Point the carrier's webhooks at the URLs `/admin/comms` lists.
3. Redeploy. No migration, no code change.

Calls already in progress, recordings and callbacks stay with the carrier that
owns them, so leave the old carrier's credentials in place until its numbers
are retired. Numbers do not move by configuration (porting is a carrier
process), and AU regulatory bundles and sender approvals do not transfer.

## Twilio

1. Buy an AU number with voice and SMS; complete the regulatory bundle.
2. Create an **API key** (Standard) → `TWILIO_API_KEY_SID` / `_SECRET`. Copy the
   Account SID and Auth Token → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
3. On the number:
   - Messaging → *A message comes in*: `POST {origin}/api/comms/twilio/sms-inbound`
   - Voice → *A call comes in*: `POST {origin}/api/comms/twilio/voice-inbound`
   - Voice → *Call status changes*: `POST {origin}/api/comms/twilio/voice-status`
4. Optional: `TWILIO_EDGE=sydney` for the browser phone's media.

Outbound calls and texts set their own callback URLs; nothing else to
configure.

## Telnyx

1. Order an AU number with voice and SMS; complete the regulatory requirements.
2. Mission Control → Keys & Credentials: create an API key → `TELNYX_API_KEY`;
   copy the **Public Key** → `TELNYX_PUBLIC_KEY`.
3. **Messaging profile**: inbound webhook `{origin}/api/comms/telnyx/sms`, attach
   the number → `TELNYX_MESSAGING_PROFILE_ID`.
4. **Call Control application**: webhook `{origin}/api/comms/telnyx/voice`,
   attach the number and an outbound voice profile that allows Australia →
   `TELNYX_CONNECTION_ID`.
5. **Credential connection** for browser logins → `TELNYX_WEBRTC_CONNECTION_ID`.
   Only outbound calls use it (the browser takes the second leg of a call its
   user placed). Under Authentication and routing set **Receive SIP URI calls**
   to **Only from my Connections**. Left at "Not enabled", Telnyx refuses every
   transfer to the browser with SIP 403 (`hangup_cause: user_busy`) before the
   browser sees it: the customer hears "we couldn't connect you" and the
   browser never rings. Do not attach the number here — it belongs on the Call
   Control application (step 4).
6. The number's own **call recording** setting records every call again, as
   single-channel WAV, on top of the recordings Royal starts. The app copies
   those too, but leave it off: Royal decides when a call is recorded.

## Mili, the voice agent

Mili answers every inbound call on either carrier, after the recording
declaration. She takes the caller's name, number, suburb and what they need,
and never quotes a price, a date or a commitment (the rules are in
`lib/domain/comms/calls/voice-agent.ts`). She can end the call or hand the
caller to the office mobile. With disclosure switched on she also answers
callers the records recognise, within their role (below).

Two models on AI Gateway, and nothing else:

- **Her voice is `openai/gpt-live-1.1`** (GPT-Live 1.1, $3 per session hour), on the
  Gateway's native Live socket — not the realtime API, where the Gateway
  refuses it with `invalid_model`. The app mints a single-use Live client
  secret with its own Gateway credential (`AI_GATEWAY_API_KEY`, else the
  deployment's Vercel OIDC token). Phone audio is 8 kHz μ-law and Live speaks
  it too, so audio passes through untouched. She speaks first.
- **The call desk is `zai/glm-5.3-flash`.** Live cannot call tools, so after
  each thing Mili says (and whenever Live delegates) the desk reads the
  transcript and calls `end_call` or `transfer_to_team` — only after she has
  said goodbye, or told the caller she is putting them through. Its rules sit
  with hers in the domain file.

How it works: the carrier streams the call's audio over a WebSocket to
`wss://{origin}/api/comms/voice-agent/{twilio|telnyx}`, a route on this app
that Vercel upgrades and keeps alive for the conversation (up to 270 s, inside
the route's 300 s limit; she is asked to wrap up 45 s before). Each stream must
present a token the app signed for that call. When she finishes, the
transcript is saved and the call moves on (hang up, mobile, voicemail).

A caller who goes quiet: 8 s of silence after she has finished speaking and
she follows up (are they still there, the next thing she needs); after two
unanswered follow-ups she tells them their query has been recorded and someone
from the team will get back to them, says goodbye, and the call hangs up.
Anything from the caller loud enough to be speech starts the count again.

Recording transcripts: speech-to-text gives one block of prose, so a text model
then splits a call recording into `Royal:` / `Caller:` / `Mili:` / `Contact:`
lines. The split is kept only if it holds every word of the prose in the same
order; otherwise the prose is kept. Voicemails stay as prose.

To try her without a phone, the session tests in
`tests/comms/voice-agent.test.ts` drive one conversation end to end with fakes.

1. `COMMS_AGENT_ENABLED=true` and `COMMS_AGENT_SECRET` (`openssl rand -hex 32`).
2. `AI_GATEWAY_API_KEY` set (or Vercel OIDC on the deployment).
3. Optional: `COMMS_AGENT_VOICE` (`marin` default, `coral`, `shimmer`, `sage`),
   `COMMS_STAFF_FORWARD_NUMBER` for handovers.
4. No carrier console setup beyond the voice webhooks above — the app gives
   the carrier the stream address on each call.

Only a Vercel deployment can upgrade the WebSocket. Under `next dev` the stream
is refused and calls go to the mobile, then voicemail — test Mili on a preview
deployment with `COMMS_WEBHOOK_ORIGIN` set to it.

### Answering known callers from Royal's records (issue #528)

With `COMMS_AGENT_DISCLOSURE_ENABLED=true`, Mili answers a caller that Royal's
records recognise, from those records, read-only. It is **off by default** and
separate from `COMMS_AGENT_ENABLED`: switching it off (and redeploying) leaves
her taking messages on every **new** call. A call already connected keeps the
briefing and lookups it started with until it ends, which is at most 270
seconds. `/admin/comms` shows it as **Mili answers known callers from
records**.

The rules live in `lib/domain/comms/callers/`; the voice code only wires them.

| Caller | What Mili may tell them | Never |
| --- | --- | --- |
| **Admin** | An overview at the start (live projects, the week's trade bookings, the pipeline, today's and tomorrow's meetings). Anything else through the call desk's lookups: a project's status, a project's money (contract value, trade costs, forecast profit, progress claims paid and outstanding), a lead, a tradie and their bookings, the bookings for a period, the pipeline. | Passwords, tokens, keys, bank details, anything outside those lookups, and any change. |
| **Site manager** | Projects assigned to them: status, stages in progress and coming up with the current schedule's dates, and the trades booked over the next three weeks. | Other projects, prices, costs, payments, contracts (#158). |
| **Customer / lead** | Their own projects (the stage as "under construction" and the like, never an internal flag such as "delayed"; current and next stages with the current schedule's dates) and their enquiries with no project yet (where it is up to, a booked meeting). | Other people's records, prices, payments, notes, staff. |
| **Tradie** | Their own bookings from two weeks back to three months ahead: the activity, trade, project name and site address, the date, and the booking's status. | Prices, other trades, the customer's details, notes. |
| **Unknown** | Message taking, exactly as before. She never says whether a number or a name has a record. | Everything else. |

Dates are said as "the current schedule shows…", never as a promise. A blank or
missing fact is "I don't have that in front of me — I'll have the team follow
up." She cannot change anything. Lookups are for admins only: the call desk is
offered them only on an admin's call, and the domain refuses any other class.

**How a caller is identified.** By the carrier-provided number on the call
(`Call.customerNumber`, from a signed webhook) alone, matched against
`User.phone`, `Customer.phone`, `Lead.phone`/`phoneE164`, `Lead.secondaryPhone`
and `Tradie.phone`, after normalising each to E.164. A team phone
(`CommsTeamPhone`) is not a source. **There is no second check that the caller
holds that phone.** That was a deliberate decision for this business, and it
differs from #528's "no protected answer from caller ID alone": anyone who can
spoof a recognised number hears that caller's briefing. Weigh that before
switching it on, and switch it off if a spoofed call is ever suspected. Every
resolution records `verification = "caller_id"`, so a possession check (an SMS
code, a call-back) can be added later without changing the reads.

**Shared numbers fail closed.** Every match is collected before anything is
chosen. A customer, their portal account and the lead their project came from
are one person; so are client records sharing the number under the same name
(a repeat enquiry). Anything else — two people, a staff number also typed on a
lead, a tradie who is also a client — is ambiguous, and the caller gets
message taking. A GUEST account or an archived tradie or lead grants nothing.
Before switching it on, run:

```
pnpm comms:audit-caller-phones
```

It lists every number more than one record holds, masked, with what a call
from it would get (AMBIGUOUS, UNSUPPORTED, INACTIVE or COMBINED). It picks no
winners: correct or merge the records in the app. (On Node 25 here, `tsx`
fails to load libphonenumber's metadata — `whatsapp:backfill-phones` fails the
same way — so run it where that script runs.)

**Fail closed.** If resolving the caller or building their briefing fails or
takes longer than 4 s, Mili starts as for an unknown caller and the failure is
reported. A lookup that fails, is refused or takes longer than 6 s is told to
her as "I couldn't check that just now", never as "nothing found". Nothing ever
falls back to wider access.

**Audit.** Each call's resolution, briefing and lookups leave a
`CallerAccessEvent` row: the class, the outcome or refusal reason, the
verification method, the lookup's name and the record ids read. No contents,
no numbers, nothing the caller said.

## WhatsApp calling

1. In WhatsApp Manager, enable calling on the number; subscribe the app to the
   `calls` webhook field (same callback URL as messages).
2. `WHATSAPP_CALLING_ENABLED=true`.
3. Networks that block UDP need TURN: Twilio's is used automatically when Twilio
   is configured; otherwise set `WHATSAPP_CALL_TURN_URLS` (+ username and
   credential).

## Not yet verified against a live account

Coded from the docs (file 07 marks these `VERIFY`). Before relying on them,
capture one real signed request of each and add it to `tests/comms` as a
fixture:

- **Mili**: Twilio `<Connect><Stream>` with a `statusCallback` and `action`,
  and that a live-call TwiML update does not then request the action; Telnyx
  `streaming_start` field names (`stream_bidirectional_mode`, `…_codec`), and
  both carriers' stream frame shapes (`lib/comms/voice-agent/frames.ts`);
  Live delegations firing reliably (they do not: one of two identical calls
  delegated, which is why the desk also runs after every turn). (Verified
  2026-11-12: the `streaming.failed` event name; GPT-Live's socket, client
  secret, `audio/pcmu` at 8 kHz both ways, transcript deltas with `start_ms`,
  and the delegation event shape, against the live service.)
- **Telnyx**: field names on `call.*` and `message.*` events; `client_state` on
  the legs a `transfer` creates; hangup causes; the telephony-credential token
  endpoint returning plain text; `GET /calls/{id}` after a call ends;
  `client_state`'s size limit. (Verified 2026-11-12: the `X-Royal-Call-Id`
  header on a `transfer` reaches `@telnyx/webrtc` as
  `dialogParams.custom_headers` on the invite.)
- **Twilio**: the signature algorithm matches Twilio's published example (see
  `tests/comms/signatures.test.ts`); everything else follows long-stable APIs,
  but run the checklist below once.
- **Meta Calling API**: `pre_accept`/`accept`/`connect` field names, the
  `call_permission_request` interactive message and its reply, the call
  status webhook shape, and the ring window (~45 s assumed).

## Launch checklist (per carrier)

- [ ] `/admin/comms` shows no problems; the webhook URLs match the console.
- [ ] Text a test lead; see Sent → Delivered. Reply from the phone; the reply lands on the lead.
- [ ] Text `STOP`; sending is refused with the opt-out sentence. Text `START`.
- [ ] Text the number from a phone no lead has; it appears on `/admin/comms`; file it onto a lead.
- [ ] Call a lead from the browser; your browser picks up when they answer. Hang up from each end.
- [ ] Add a team phone on `/admin/comms`. On a lead, pick it from the **Call via …** menu and call: the lead rings first, then that phone, showing the business number. The call reads "via <nickname>".
- [ ] Ring the business number: hear the declaration, then Mili. Leave a message and say goodbye; the call shows "answered by Mili" with a transcript and a recording on the lead.
- [ ] Ask Mili for a person: the office mobile rings. Don't answer: voicemail is stored and plays on the lead.
- [ ] With `COMMS_AGENT_ENABLED=false`: the declaration, then the office mobile, then voicemail. No browser rings.
- [ ] Known callers (`COMMS_AGENT_DISCLOSURE_ENABLED=true`), on both carriers: `pnpm comms:audit-caller-phones` shows nothing unexpected. Ring from a test customer's number: she can say their project's current stage and dates, and refuses a price. From a test tradie's number: only their bookings. From a site manager's: only assigned projects. From an admin's: ask "how's the <project> job going?" and "what's been paid on <project>?" — she says she'll check, then answers. From an unknown number, and with caller ID withheld: message taking only, and she won't say whether a name has a project. Ask for a person mid-answer: transferred. Set the flag back to `false`, redeploy, and ring from the admin's number: message taking only. Each call's `CallerAccessEvent` rows match what was asked.
- [ ] With `COMMS_RECORDING_MODE=consented`, on an outbound call: the recording announcement plays, the call is put straight through, and the conversation is recorded. Check the carrier's console shows the recording deleted after the copy.
- [ ] WhatsApp: ask permission, allow it on the phone, call from the chat; call the business on WhatsApp and answer in the dock.
- [ ] Next morning, the `comms-sweep` cron log shows no stale calls.
