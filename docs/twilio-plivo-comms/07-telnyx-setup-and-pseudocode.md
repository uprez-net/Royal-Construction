# 7. Telnyx: setup and adapter pseudocode (AU)

Telnyx is the third provider behind the [provider-agnostic architecture](./06-provider-agnostic-architecture.md).
Like [Twilio](./02-twilio-setup-and-pseudocode.md) and [Plivo](./03-plivo-setup-and-pseudocode.md),
it plugs into the contracts in [file 01](./01-architecture-and-contracts.md). No SDK is
required: everything below is HTTPS, JSON, base64 and Ed25519.

**Research date: 3 November 2026.** Sources read:
[Receiving webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks),
[Telephony credentials](https://developers.telnyx.com/docs/voice/webrtc/auth/telephony-credentials),
the Telnyx docs index ([llms.txt](https://developers.telnyx.com/llms.txt)), its
[Voice API](https://developers.telnyx.com/public/llms/calling/voice-api.txt) and
[WebRTC](https://developers.telnyx.com/public/llms/calling/webrtc.txt) summaries, and the
[OpenAPI spec](https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json).

**Confidence.** The webhook signature scheme, the messaging webhook shapes and the
telephony-credential creation endpoint were read directly. Everything marked **VERIFY**
was inferred from index pages or recollection and must be confirmed against the OpenAPI
spec or a real request before coding. **Pricing was not researched**; see
[file 04](./04-au-cost-comparison.md#telnyx).

## 1. Account and console setup

1. **Create an account** at telnyx.com, complete identity verification and add credit.
   Create separate API keys for production and testing (Mission Control → Keys &
   Credentials).
2. **Copy the Public Key** (Keys & Credentials → Public Key). It is used to verify every
   webhook.
3. **Numbers.** Order an Australian number that supports voice and SMS. AU numbers need
   regulatory documents (identity and an Australian address); allow review time.
   **VERIFY** current AU requirements and SMS capability for the number type you pick.
   Alphanumeric sender IDs need ACMA registration (see README compliance section).
4. **Messaging profile.** Create one, set its inbound webhook URL to
   `https://<origin>/api/comms/telnyx/sms` and attach the number. Use the profile
   ID as `TELNYX_MESSAGING_PROFILE_ID`.
5. **Call Control Application** (voice). Create one, set the webhook URL to
   `https://<origin>/api/comms/telnyx/voice`, then attach the number and an **outbound
   voice profile** (required to dial out; restrict allowed destinations to Australia).
   Its ID is `TELNYX_CONNECTION_ID`. **VERIFY** the exact name of the required ID field in
   `POST /v2/calls`.
6. **Credential connection for browser calling.** Create a credential-based SIP connection
   used by the WebRTC clients. Its ID is `TELNYX_WEBRTC_CONNECTION_ID`.
7. **Webhook delivery.** Enable the failover URL if you have one. Telnyx retries failed
   deliveries, so handlers must be idempotent.

### Environment variables

```env
COMMUNICATIONS_PROVIDER=telnyx
COMMS_WEBHOOK_ORIGIN=https://crm.example.com.au
TELNYX_API_KEY=
TELNYX_PUBLIC_KEY=
TELNYX_CONNECTION_ID=
TELNYX_WEBRTC_CONNECTION_ID=
TELNYX_MESSAGING_PROFILE_ID=
```

### Route table

| Route                          | Purpose                                                                       | Response       |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------- |
| `POST /api/comms/telnyx/sms`   | `message.received`, `message.sent`, `message.finalized`                       | `200` / `204`  |
| `POST /api/comms/telnyx/voice` | Every Call Control event: inbound and outbound calls, transfers, recordings  | `200`, no body |

Telnyx posts JSON and ignores the response body for Call Control. Command-driven flows act
through REST, not through the webhook response (this differs from Twilio and Plivo).

## 2. Webhook signature (Ed25519)

Headers: `telnyx-signature-ed25519` (base64 signature) and `telnyx-timestamp` (Unix
seconds). The signed string is `"<timestamp>|<raw request body>"`. Reject if the timestamp
is older than **5 minutes**. Verify the **raw bytes**, not a re-serialised JSON object.

```ts
import { createPublicKey, verify } from "node:crypto"

// Raw 32-byte Ed25519 key -> SPKI DER by prefixing the fixed header.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function verifyTelnyx(
  req: { headers: Headers; rawBody: string },
  publicKeyB64: string
) {
  const signature = req.headers.get("telnyx-signature-ed25519")
  const timestamp = req.headers.get("telnyx-timestamp")
  if (!signature || !timestamp || !publicKeyB64) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyB64, "base64")]),
    format: "der",
    type: "spki",
  })
  return verify(
    null, // Ed25519 takes no digest
    Buffer.from(`${timestamp}|${req.rawBody}`, "utf8"),
    key,
    Buffer.from(signature, "base64")
  )
}
```

Read the body once as text (cap at 64 KB), verify, then `JSON.parse`. A key that is not
32 bytes after decoding is a configuration error, not a signature failure: log it as
`config`. Test with a real delivery copied from Mission Control as a fixture.

## 3. REST client

Base `https://api.telnyx.com/v2`, `Authorization: Bearer <TELNYX_API_KEY>`, JSON bodies.
Errors are JSON with an `errors[]` array (**VERIFY** field names; use `errors[0].code` for
`providerCode`, prefixed `TELNYX_`).

```ts
async function telnyx(method, path, body?) {
  const res = await http.request(method, "https://api.telnyx.com/v2" + path, {
    headers: {
      Authorization: "Bearer " + env("TELNYX_API_KEY"),
      "Content-Type": "application/json",
    },
    body: body && json.stringify(body),
    timeoutMs: 15_000,
  }) // no automatic retries
  if (res.status >= 200 && res.status < 300) return json.parse(res.body)
  const code =
    "TELNYX_" + (json.parse(res.body)?.errors?.[0]?.code ?? res.status)
  // 4xx (except 429): definite rejection. Timeout / 5xx / 429: may have happened.
  throw new CommsError(
    res.status >= 400 && res.status < 500 && res.status !== 429
      ? "rejected"
      : "uncertain",
    code
  )
}
```

## 4. Messaging

```ts
// POST /messages
async function sendSms({ from, to, body }) {
  const r = await telnyx("POST", "/messages", {
    from,
    to,
    text: body,
    messaging_profile_id: env("TELNYX_MESSAGING_PROFILE_ID"),
    webhook_url: commsCallbackUrl(origin, "telnyx", "sms"), // per-message status URL
  })
  return { providerMessageId: r.data.id }
}
```

Numbers are E.164 with `+` in both directions.

### Inbound and status events

`message.received`: `data.event_type`, `data.payload.id`, `payload.from.phone_number`,
`payload.to[0].phone_number`, `payload.text`, `payload.media[]` (MMS).

Outbound status: `message.sent` and `message.finalized`. `data.payload.to[0].status` on
finalisation is one of `delivered`, `delivery_failed`, `sending_failed`,
`delivery_unconfirmed` (documented examples). Map:

| Telnyx                              | Internal                                               |
| ----------------------------------- | ------------------------------------------------------ |
| `queued`, `sending`                 | `queued`                                               |
| `sent`                              | `sent`                                                 |
| `delivered`                         | `delivered`                                            |
| `delivery_failed`, `sending_failed` | `failed`                                               |
| `delivery_unconfirmed`              | `sent` (not proven delivered; do not show "delivered") |

Dedupe key: `data.id` of the event (retries reuse it) for events; `payload.id` for the
message itself. Use `payload.errors[0].code` as `errorCode`.

## 5. Voice

Telnyx Call Control is **command based** (see
[file 06 §3.1](./06-provider-agnostic-architecture.md#31-why-call-control-has-two-models)):
you receive events and send REST commands. There is no markup response.

### Outbound call to a lead, then bridge to the agent's browser

```ts
// POST /calls  (VERIFY required fields and response keys in the spec)
async function placeCall(i) {
  const r = await telnyx("POST", "/calls", {
    connection_id: env("TELNYX_CONNECTION_ID"),
    to: i.to,
    from: i.from,
    webhook_url: i.statusUrl, // carries ?callId=<internal id>
    timeout_secs: i.timeoutSec,
    time_limit_secs: i.timeLimitSec,
  })
  return { providerCallId: r.data.call_control_id } // VERIFY name; index mentions call_leg_id
}
```

Flow: the `voice` route receives `call.answered` for the customer leg → it asks the
domain what to do (`answeredOutboundCall`, same as the Twilio `customer-connect` route)
→ `callControl.execute(callId, [{ op: "dialBrowser", identity, … }])` which issues a
`transfer` (or `bridge` to a leg created by dialling the agent) to the agent's SIP URI.
In `consented` recording mode the customer is first asked for recording consent
(`gather_using_speak`), the same as inbound calls (`decideCallStart`); recording starts
only after they consent and the call connects (section 7). Otherwise the call connects
straight away and is not recorded.

### Commands used (names from the Telnyx index; confirm paths)

| Instruction     | Telnyx command                                                            | Notes                                            |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| `hangup`        | `POST /calls/{id}/actions/hangup`                                         | Also cancels a ringing outbound call.            |
| `play`          | "Play audio URL" (`playback_start`; **VERIFY**)                           | Host prompts on HTTPS like today's Play clips.   |
| `say`           | "Speak text" (`speak`; **VERIFY**)                                        | Check `en-AU` voice availability.                |
| `dialBrowser`   | `transfer` to `sip:<credential sip_username>@sip.telnyx.com` (**VERIFY**) | Needs the user's telephony credential username.  |
| `dialNumber`    | `transfer` / dial a second leg then `bridge`                              | Timeouts and caller ID per command parameters.   |
| `redirect`      | not applicable                                                            | `unsupported`; steer by issuing commands.        |
| `pause`         | none                                                                      | `unsupported` (do not fake with silent audio).   |
| record / stream | "Recording start", "Streaming start"                                      | Out of scope until inbound/AI work (file 06 §9). |

Incoming calls to the number must be **answered** with the `answer` command before other
commands run. `client_state` (base64 string) is echoed in later webhooks; do not rely on
it for authorisation. Use the internal `?callId=` plus a database lookup.

### End and status lookup

```ts
endCall(id) = telnyx("POST", `/calls/${id}/actions/hangup`, {})
getCallStatus(id) = telnyx("GET", `/calls/${id}`) // VERIFY: returns is_alive
```

A lookup that returns "not alive" can confirm a call ended, but not whether it was
completed, busy or unanswered, and gives no duration. The reconciler should record
`completed` with a null duration. An unknown call (404) maps to the existing "call not
found, review" state.

### Parsing call events

| Event (`data.event_type`) | Internal state | Fields                                                     |
| ------------------------- | -------------- | ---------------------------------------------------------- |
| `call.initiated`          | `initiated`    | `payload.call_control_id`, `from`, `to`, `direction`       |
| `call.answered`           | `in-progress`  | Triggers the bridge step for outbound calls.               |
| `call.hangup`             | by cause       | `hangup_cause`, `start_time`, `end_time`; see file 06 §6.2 |

Other events (bridged, playback, recording) are ignored unless a flow needs them. Event ID
= `data.id`; call ID = `payload.call_control_id`. **VERIFY** all field names against a
real captured event.

## 6. Browser calling (Telnyx WebRTC)

The backend issues a short-lived credential; the browser never sees `TELNYX_API_KEY`.

```ts
// 1. Find or create a telephony credential for this identity (tag = identity)
//    POST /telephony_credentials { connection_id: TELNYX_WEBRTC_CONNECTION_ID,
//                                  name, tag: identity, expires_at }
//    (documented; response not shown, VERIFY)
// 2. Create a JWT for the credential (the docs call this "Create an Access Token";
//    path likely POST /telephony_credentials/{id}/token, VERIFY) and return it.
async function issueCredential(identity, ttl) {
  const cred = await findOrCreateCredential(identity, ttl)
  const token = await telnyxText(
    "POST",
    `/telephony_credentials/${cred.id}/token`
  )
  return {
    provider: "telnyx",
    token,
    identity,
    ttlSeconds: ttl,
    options: { mode: "login_token" },
  }
}
```

Client: the `@telnyx/webrtc` package (`TelnyxRTC`). Authenticate with the token (JWT login)
or with the credential's `sip_username` / `sip_password`; prefer the token so no password
reaches the browser. The docs state **one credential per device**, so concurrent browser
tabs need separate credentials; use `tag = identity:<tabId>`. Credentials may take about
5 seconds to become usable: retry login with short backoff. Check registration with
`GET /v2/sip_registration_status?credential_type=telephony_credential&username=<sip_username>`.

The SDK **is bundled**: `components/comms/dialer/telnyx-dialer.ts` implements `Dialer`
(file 06 §8) over `@telnyx/webrtc`, loaded only when the active provider is Telnyx, and
the adapter reports `browserSdkBundled: true`. A transfer rings one browser (the most
recently active staff member, `browserRingGroup: false`); Royal's call id reaches the
browser in the `X-Royal-Call-Id` custom header (**VERIFY** against a live account).

## 7. Inbound calls, recordings and the AI voice agent

**Inbound call flow: implemented** (`capabilities.inboundCallFlow = true`). An incoming
call is answered with the `answer` command; its `call.answered` event asks the domain for
the next steps, which run as commands: the recording declaration (`speak`), then Mili
(below) — or, without her, a `transfer` to the office mobile, then voicemail
(`record_start`). An inbound call never rings a browser. A step that finishes later
carries the remaining steps in `client_state`, and the matching `.ended`/`.saved` event
continues them. With calling switched off, a ringing call is hung up without being
answered.

**Recordings: implemented** (`capabilities.recordings = true` when Telnyx is configured).
Consented calls start `record_start` (dual channel, mp3) once connected; voicemails use the
same command. The "recording saved" event files the recording; the copy job asks
`GET /recordings/{id}` for a fresh download link (the link in the callback is never
fetched), stores the audio privately, then `DELETE`s it at Telnyx.

**AI voice agent (Mili): implemented, not yet verified on a live account.** After the
declaration, `connectAgent` issues `record_start` (dual, marked `rk` in `client_state` so
a late save is filed as the conversation) and `streaming_start` with
`stream_url=wss://<origin>/api/comms/voice-agent/telnyx?token=…`, bidirectional RTP,
PCMU. The route bridges the audio to `openai/gpt-live-1.1` (GPT-Live, native Live socket) on AI Gateway
(`lib/comms/voice-agent`). When she finishes, the domain decides the next step and the
adapter runs it (`streaming_stop`, then `speak`/`transfer`/`hangup`). A
`streaming.failed` event sends the caller to the office mobile, then voicemail. Capture
real stream frames and the `streaming.*` events and add them to `tests/comms` before
relying on it; Twilio uses the same route through `<Connect><Stream>`.

Field names on all of the above are still **VERIFY** items; see the
[runbook](../comms-runbook.md#not-yet-verified-against-a-live-account).

## 8. Telnyx-specific gotchas

- **Raw-body verification.** Frameworks that parse JSON before your handler break the
  signature. Read the body as text first.
- **Timestamp tolerance** is 5 minutes. Clock skew on the server causes valid webhooks to
  fail; use NTP.
- **Commands race events.** A command sent before the matching event is processed can
  fail; issue commands from the webhook handler after loading the call.
- **Retries.** Telnyx retries non-2xx responses. Answer `200` fast and do work in the
  workflow/effect queue.
- **Credentials are per device** and not immediately usable.
- **Outbound voice profile** must allow Australia, or `POST /calls` is rejected.
- **No pause/redirect** instructions in the command model.
- **Duration** is derived from event timestamps, not billing records.
- **Number format** is E.164 with `+`, unlike Plivo.
