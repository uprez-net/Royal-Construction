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
| Outbound calls | The carrier rings the lead first. When they answer they hear "Connecting you now" (or the recording question) and are put through to **your browser** (picked up automatically) or the **office mobile**. A browser credential can only receive calls, so it can never dial anyone. |
| Inbound calls | Never ring a browser. The caller hears "this call is being recorded", then **Mili**, the voice agent, answers and takes a message (see below). If Mili is off or can't be reached, or the caller asks for a person, the office mobile rings, then voicemail. Mili's transcript and the recording land on the lead's call. |
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
declaration. She runs on `openai/gpt-realtime-2` through AI Gateway with a female
voice, takes the caller's name, number, suburb and what they need, and never
quotes a price, a date or a commitment (the rules are in
`lib/domain/comms/calls/voice-agent.ts`). She can end the call or hand the
caller to the office mobile.

How it works: the carrier streams the call's audio over a WebSocket to
`wss://{origin}/api/comms/voice-agent/{twilio|telnyx}`, a route on this app
that Vercel upgrades and keeps alive for the conversation (up to 270 s, inside
the route's 300 s limit; she is asked to wrap up 45 s before). Each stream must
present a token the app signed for that call. When she finishes, the
transcript is saved and the call moves on (hang up, mobile, voicemail).

1. `COMMS_AGENT_ENABLED=true` and `COMMS_AGENT_SECRET` (`openssl rand -hex 32`).
2. `AI_GATEWAY_API_KEY` set (or Vercel OIDC on the deployment).
3. Optional: `COMMS_AGENT_VOICE` (`marin` default, `coral`, `shimmer`, `sage`),
   `COMMS_STAFF_FORWARD_NUMBER` for handovers.
4. No carrier console setup beyond the voice webhooks above — the app gives
   the carrier the stream address on each call.

Only a Vercel deployment can upgrade the WebSocket. Under `next dev` the stream
is refused and calls go to the mobile, then voicemail — test Mili on a preview
deployment with `COMMS_WEBHOOK_ORIGIN` set to it.

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
  tool calls on the AI Gateway realtime session. (Verified 2026-11-12: the
  `streaming.failed` event name; `openai/gpt-realtime-2` accepting Mili's
  session config and greeting on `response-create`. `openai/gpt-live-1` is
  refused with `invalid_model` — not served in realtime mode.)
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
- [ ] Call via office mobile.
- [ ] Ring the business number: hear the declaration, then Mili. Leave a message and say goodbye; the call shows "answered by Mili" with a transcript and a recording on the lead.
- [ ] Ask Mili for a person: the office mobile rings. Don't answer: voicemail is stored and plays on the lead.
- [ ] With `COMMS_AGENT_ENABLED=false`: the declaration, then the office mobile, then voicemail. No browser rings.
- [ ] With `COMMS_RECORDING_MODE=consented`, on an outbound call: the recording announcement plays, the call is put straight through, and the conversation is recorded. Check the carrier's console shows the recording deleted after the copy.
- [ ] WhatsApp: ask permission, allow it on the phone, call from the chat; call the business on WhatsApp and answer in the dock.
- [ ] Next morning, the `comms-sweep` cron log shows no stale calls.
