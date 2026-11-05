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
| Inbound calls | Rings every staff browser with the app open (Twilio; Telnyx rings the most recently active one), then the office mobile, then voicemail. |
| Recording | Off unless `COMMS_RECORDING_MODE=consented`. Then the customer is asked to press 1; anything else means not recorded. Recordings and voicemails are copied to Blob storage and deleted at the carrier. |
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
   Turn on simultaneous ringing so every tab of the same user rings.

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

- **Telnyx**: field names on `call.*` and `message.*` events; `client_state` on
  the legs a `transfer` creates; hangup causes; the telephony-credential token
  endpoint returning plain text; `GET /calls/{id}` after a call ends; the
  `X-Royal-Call-Id` custom header reaching `@telnyx/webrtc`; `client_state`'s
  size limit.
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
- [ ] Ring the business number with the app open (browser rings), closed (mobile rings), and with nobody answering (voicemail is stored and plays on the lead).
- [ ] With `COMMS_RECORDING_MODE=consented`: press 1 (recorded), press 2 and stay silent (not recorded). Check the carrier's console shows the recording deleted after the copy.
- [ ] WhatsApp: ask permission, allow it on the phone, call from the chat; call the business on WhatsApp and answer in the dock.
- [ ] Next morning, the `comms-sweep` cron log shows no stale calls.
