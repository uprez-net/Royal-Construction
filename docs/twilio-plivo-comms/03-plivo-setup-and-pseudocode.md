# 3. Plivo: setup and adapter pseudocode (AU)

Implements the [`CommsProvider` port](./01-architecture-and-contracts.md#4-the-commsprovider-port)
with raw HTTPS. No Plivo SDK required. Rates are in [file 04](./04-au-cost-comparison.md).
Items marked `VERIFY` were not confirmed from Plivo's primary docs on the research date, or
those docs contradict each other. Capture a real payload as a fixture before you code against
them.

## 1. Account and console setup

Use a **sub-account per environment**. Each sub-account has its own Auth ID and Auth Token, and
webhooks are signed with the token of the account that owns the number.

| #   | Step                            | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sign up and upgrade             | Complete KYC, add credit and auto-recharge, and enable MFA. Plivo bills in **USD** (or INR); there is no AUD billing.                                                                                                                                                                                                                                                                                                                                                       |
| 2   | Data region                     | `VERIFY` the data-region options in the Account Limits / data-region docs. If data residency matters, confirm where call media, recordings and message logs are processed and stored.                                                                                                                                                                                                                                                                                       |
| 3   | Compliance application          | Console → Phone Numbers → **Compliance Application** → country **Australia**, number type **Mobile**, end user **Business**. Upload business identity and an Australian street-address proof (no PO box for voice + SMS). The number stays `in-review` until it is approved.                                                                                                                                                                                                |
| 4   | Buy the number                  | Phone Numbers → Buy → AU **mobile** (`+614…`), linked to the compliance application. Plivo offers mobile numbers in only a few countries; AU is one of them. Mobile gives voice + SMS.                                                                                                                                                                                                                                                                                      |
| 5   | Main XML Application            | Voice → Applications → **XML** → Answer URL `POST {origin}/webhooks/plivo/voice/answer`, Hangup URL `POST {origin}/webhooks/plivo/voice/hangup`, Fallback Answer URL `{origin}/webhooks/plivo/voice/fallback`, Message URL `POST {origin}/webhooks/plivo/messages/inbound`. Assign the number to this application.                                                                                                                                                          |
| 6   | Browser Application + Endpoints | Create a second XML Application, "browser-outbound", with Answer URL `{origin}/webhooks/plivo/voice/browser-outbound`. Voice → **Endpoints** → create one endpoint per staff member (username such as `staff42…`) attached to this application.                                                                                                                                                                                                                             |
| 7   | WhatsApp onboarding             | Messaging → WhatsApp → onboard through Meta embedded signup. Link or create the WhatsApp Business Account (WABA), register the AU mobile number (it must not be active on the WhatsApp app) and get the display name approved. **USD 10/month per WABA** applies from 1 November 2026.                                                                                                                                                                                      |
| 8   | WhatsApp number config          | WhatsApp → Numbers → Configure Number → Configuration Type **Webhook URL** = `{origin}/webhooks/plivo/whatsapp/inbound`.                                                                                                                                                                                                                                                                                                                                                    |
| 9   | WhatsApp templates              | Create templates in the Plivo console or Meta WhatsApp Manager and get them approved. Store `name`, `language` and `category` in your `Template` table.                                                                                                                                                                                                                                                                                                                     |
| 10  | WhatsApp calling                | In the same Configure Number panel, turn on **Enable WhatsApp Calling** and set Answer URL `{origin}/webhooks/plivo/whatsapp/voice/answer`. Under **Account Mapping**, choose the (sub)account. The mapping applies to the **whole WABA**. Set call hours and callback permission in Meta Business Manager → Phone Numbers → Calls. Older guides that require a separate XML application for this are outdated, but Plivo's docs are inconsistent: `VERIFY` in the console. |
| 11  | Recording access                | `VERIFY` whether recording URLs need authentication on your account. Treat every recording URL as a secret, and delete the Plivo copy after you copy it to private storage.                                                                                                                                                                                                                                                                                                 |
| 12  | Alerts                          | Set a low-balance alert, and poll usage daily for spend alerts.                                                                                                                                                                                                                                                                                                                                                                                                             |

### Environment variables

```
PLIVO_AUTH_ID               = MA… / SA…       # (sub)account Auth ID for this environment
PLIVO_AUTH_TOKEN            = …
PLIVO_AUTH_TOKEN_PREVIOUS   = …               # optional, during rotation (Plivo can have several active tokens)
PLIVO_BROWSER_APP_ID        = …               # browser-outbound application
PLIVO_WHATSAPP_NUMBER       = +61…
STREAM_TOKEN_SECRET         = 32+ random bytes
```

### Route table

| Method | Path                                     | Purpose                                   | Response           |
| ------ | ---------------------------------------- | ----------------------------------------- | ------------------ |
| POST   | `/webhooks/plivo/messages/inbound`       | Inbound SMS                               | `200`              |
| POST   | `/webhooks/plivo/whatsapp/inbound`       | Inbound WhatsApp message / button reply   | `200`              |
| POST   | `/webhooks/plivo/messages/status`        | Delivery status (`url` param on send)     | `200`              |
| POST   | `/webhooks/plivo/voice/answer`           | Inbound PSTN call                         | Plivo XML          |
| POST   | `/webhooks/plivo/voice/fallback`         | Answer URL failed (3 retries / 60 s)      | Plivo XML (static) |
| POST   | `/webhooks/plivo/whatsapp/voice/answer`  | Inbound WhatsApp call                     | Plivo XML          |
| POST   | `/webhooks/plivo/voice/browser-outbound` | Endpoint (browser) dialled out            | Plivo XML          |
| POST   | `/webhooks/plivo/voice/outbound-connect` | Customer-first API call answered          | Plivo XML          |
| POST   | `/webhooks/plivo/voice/consent`          | `GetDigits` result                        | Plivo XML          |
| POST   | `/webhooks/plivo/voice/dial-complete`    | `<Dial action>` result                    | Plivo XML          |
| POST   | `/webhooks/plivo/voice/after-agent`      | Stream ended → hand-over                  | Plivo XML          |
| POST   | `/webhooks/plivo/voice/hangup`           | Call ended (final status, duration, cost) | `200`              |
| POST   | `/webhooks/plivo/voice/ring`             | Outbound ringing                          | `200`              |
| POST   | `/webhooks/plivo/voice/recording`        | Record `callbackUrl`                      | `200`              |
| POST   | `/webhooks/plivo/voice/stream-status`    | Stream status callback                    | `200`              |
| GET→WS | `/ws/plivo/voice-agent`                  | Audio stream WebSocket                    | upgrade            |

## 2. Webhook signature (V3)

Headers: `X-Plivo-Signature-V3` (signed with the token of the owning account or sub-account;
may be a **comma-separated list** when several tokens are active), `X-Plivo-Signature-Ma-V3`
(always signed with the **main** account token) and `X-Plivo-Signature-V3-Nonce`.

Algorithm (ported from Plivo's reference implementation, `plivo-python`
`utils/signature_v3.py`):

```ts
function plivoSignedString(
  method: "GET" | "POST",
  publicUrl: string,
  params: Record<string, string>
): string {
  const u = new URL(publicUrl)
  const base = u.protocol + "//" + u.host + u.pathname // host includes a non-default port
  const query = decodedQueryMap(u.search) // key -> [values], blanks kept

  // "k=v&k=v" with keys sorted; list values sorted
  const sortedQuery = (m) =>
    Object.keys(m)
      .sort()
      .map((k) =>
        []
          .concat(m[k])
          .sort()
          .map((v) => `${k}=${v}`)
          .join("&")
      )
      .join("&")

  if (method === "GET") {
    const all = { ...query, ...params } // Plivo's params are already in the query
    const q = sortedQuery(all)
    return q ? `${base}?${q}` : base
  }
  // POST
  const q = sortedQuery(query)
  const postKeys = Object.keys(params).sort()
  if (postKeys.length === 0) return q ? `${base}?${q}` : base
  const post = postKeys.map((k) => k + params[k]).join("") // "keyvalue" with no separators
  return `${base}?${q}${q ? "." : ""}${post}`
}

function verifyPlivoWebhook(req): VerifiedRequest | null {
  const nonce = req.headers["x-plivo-signature-v3-nonce"]
  const header = req.headers["x-plivo-signature-v3"]
  if (!nonce || !header) return null
  const raw = readBodyCapped(req, 64 * 1024)
  const url = env("COMMS_WEBHOOK_ORIGIN") + req.path + req.rawQuery
  const params = req.method === "POST" ? formDecode(raw) : {} // GET params are inside url
  const signed = plivoSignedString(req.method, url, params) + "." + nonce
  const candidates = header.split(",").map((s) => s.trim())
  const tokens = [
    env("PLIVO_AUTH_TOKEN"),
    env("PLIVO_AUTH_TOKEN_PREVIOUS"),
  ].filter(Boolean)
  const ok = tokens.some((t) => {
    const expected = base64(hmacSha256(t, signed))
    return candidates.some((c) => timingSafeEqual(c, expected))
  })
  if (!ok) return null
  if (!consumeNonceOnce("plivo:" + nonce, 10 * MINUTE)) return null // replay protection
  return {
    provider: "plivo",
    params: { ...decodedQueryFlat(url), ...params },
    rawUrl: url,
  }
}
```

**Test vectors** (computed from the reference algorithm. Before relying on them, confirm
against one real signed request from your account):

| Method | URL                                                         | Nonce                  | Token             | String signed (before `.nonce`)                                                                                                                      | Expected `X-Plivo-Signature-V3`                |
| ------ | ----------------------------------------------------------- | ---------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| POST   | `https://example.com/webhooks/plivo/voice/answer`           | `12345678901234567890` | `test_auth_token` | `https://example.com/webhooks/plivo/voice/answer?CallUUID11111111-2222-3333-4444-555555555555DirectioninboundFrom61412345678To61298765432`           | `4uuOl/BpujEGr4i6rH9JV//mhsdkMnWT++AyuLki2ew=` |
| POST   | `https://example.com/webhooks/plivo/voice/answer?tenant=a1` | `12345678901234567890` | `test_auth_token` | `https://example.com/webhooks/plivo/voice/answer?tenant=a1.CallUUID11111111-2222-3333-4444-555555555555DirectioninboundFrom61412345678To61298765432` | `3AxFYuHPKlEoDFPv1ztGyL/GfGPL+7i9UfLHP3MHQdo=` |

POST params for both rows: `CallUUID=11111111-2222-3333-4444-555555555555`, `Direction=inbound`,
`From=61412345678`, `To=61298765432`.

## 3. REST client

```ts
async function plivoApi(method, path, body?: object) {
  return http.request(
    method,
    `https://api.plivo.com/v1/Account/${env("PLIVO_AUTH_ID")}${path}`,
    {
      headers: {
        authorization:
          "Basic " +
          base64(env("PLIVO_AUTH_ID") + ":" + env("PLIVO_AUTH_TOKEN")),
        "content-type": "application/json",
      },
      body: body ? json.stringify(body) : undefined,
      timeoutMs: 10_000,
    }
  )
}
function classifyPlivo(
  res,
  pick: (b) => string
): Accepted | Rejected | Uncertain {
  if (res.error) return { kind: "uncertain", reason: res.error }
  if (res.status >= 200 && res.status < 300)
    return { kind: "accepted", providerId: pick(json.parse(res.body)) }
  if (res.status === 429)
    return { kind: "rejected", code: "RATE_LIMIT", retryable: true }
  if (res.status >= 400 && res.status < 500)
    return {
      kind: "rejected",
      code: json.parse(res.body).error ?? String(res.status),
      retryable: false,
    }
  return { kind: "uncertain", reason: "HTTP " + res.status }
}
const plivoNumber = (e164) => e164.replace(/^\+/, "") // Plivo examples use digits only; VERIFY "+" acceptance per API
```

## 4. Messaging (SMS and WhatsApp)

```ts
async function sendMessage(m: SendMessageInput) {
  const body: any = {
    src: plivoNumber(m.from),
    dst: plivoNumber(m.to),
    type:
      m.channel === "whatsapp"
        ? "whatsapp"
        : m.mediaUrls?.length
          ? "mms"
          : "sms",
    url: origin() + "/webhooks/plivo/messages/status",
    method: "POST",
  }
  if (m.template) {
    // Meta-style template object. VERIFY exact shape against "Send Templated Messages".
    body.template = {
      name: m.template.providerTemplateRef,
      language: m.template.language, // e.g. "en" or "en_US", exactly as approved
      components: [
        {
          type: "body",
          parameters: m.template.variables.map((v) => ({
            type: "text",
            text: v,
          })),
        },
      ],
    }
  } else {
    body.text = m.body // SMS ≤ 1600 GSM chars; WhatsApp ≤ 4096
  }
  if (m.mediaUrls?.length)
    body.media_urls = m.channel === "whatsapp" ? [m.mediaUrls[0]] : m.mediaUrls
  return classifyPlivo(
    await plivoApi("POST", "/Message/", body),
    (b) => b.message_uuid[0]
  )
}
```

AU note: Plivo's AU SMS pricing page does not list MMS at all (Twilio lists AU MMS at USD 0.35).
If AU MMS is needed, `VERIFY` with Plivo before relying on it; otherwise send a link.

### Parsing inbound and status

```ts
function parseInboundMessage(v): InboundMessage {
  const p = v.params
  return {
    providerMessageId: p.MessageUUID,
    channel: p.Type === "whatsapp" ? "whatsapp" : "sms",
    from: normalizeE164(p.From),
    to: normalizeE164(p.To),
    body: p.Text ?? "",
    media: collectMedia(p), // VERIFY field names (e.g. Media0…/MediaCount, or a WhatsApp media field)
    waButtonPayload: p.ButtonPayload ?? p.Context?.payload, // VERIFY from a captured quick-reply fixture
    receivedAt: clock.now(),
  }
}
const PL_MSG_STATUS = {
  queued: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  undelivered: "undelivered",
  failed: "failed",
  rejected: "failed",
}
function parseMessageStatus(v): MessageStatusEvent {
  return {
    providerMessageId: v.params.MessageUUID,
    status: PL_MSG_STATUS[v.params.Status],
    errorCode: v.params.ErrorCode,
  }
}
```

Plivo sends inbound message webhooks form-encoded. Confirm with a fixture: the docs show only
`From`, `To` and `Text`. Route SMS and WhatsApp to separate paths so that `channel` never
depends on an unverified field.

## 5. Voice

### Plivo XML renderer

```ts
function render(steps: CallInstruction[]) {
  return {
    contentType: "application/xml",
    body: `<?xml version="1.0" encoding="UTF-8"?><Response>${steps.map(r).join("")}</Response>`,
  }
}
const a = (s) => xmlEscape(String(s))
function recordBefore(s) {
  // Plivo records a Dial with a preceding background Record
  return s.record === "from_answer_dual"
    ? `<Record recordSession="true" startOnDialAnswer="true" redirect="false" fileFormat="mp3" recordChannelType="stereo" maxLength="${MAX_CALL_SECONDS}" callbackUrl="${a(s.recordingCallbackUrl)}" callbackMethod="POST"/>`
    : ""
}
function r(s: CallInstruction): string {
  switch (s.op) {
    case "say":
      return `<Speak voice="${s.voice === "male" ? "MAN" : "WOMAN"}" language="${s.language ?? "en-AU"}">${a(s.text)}</Speak>`
    case "play":
      return `<Play>${a(s.url)}</Play>`
    case "pause":
      return `<Wait length="${s.seconds}"/>`
    case "gatherDigits":
      return `<GetDigits action="${a(s.actionUrl)}" method="POST" numDigits="${s.numDigits}" timeout="${s.timeoutSec}" retries="1" redirect="true">${s.prompt.map(r).join("")}</GetDigits>`
    // GetInput (inputType="dtmf") is the newer element; either posts "Digits" to action.
    case "dialNumber":
      return (
        recordBefore(s) +
        `<Dial callerId="${a(plivoNumber(s.callerId))}" timeout="${s.timeoutSec}" action="${a(s.actionUrl)}" method="POST" redirect="true"><Number>${a(plivoNumber(s.to))}</Number></Dial>`
      )
    case "dialBrowser":
      return (
        recordBefore(s) +
        `<Dial timeout="${s.timeoutSec}" action="${a(s.actionUrl)}" method="POST" redirect="true"${s.callerId ? ` callerId="${a(plivoNumber(s.callerId))}"` : ""}><User>sip:${a(s.staffIdentity)}@phone.plivo.com</User></Dial>`
      )
    case "dialWhatsApp": // business-initiated WhatsApp leg (needs user permission)
      return `<Dial callerId="${a(plivoNumber(s.callerId))}" callType="whatsapp" action="${a(s.actionUrl)}" method="POST"><User>${a(plivoNumber(s.to))}</User></Dial>`
    case "streamToAgent": // keepCallAlive=true -> XML continues (e.g. Redirect) after the stream ends
      return `<Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" streamTimeout="${MAX_AGENT_SECONDS}" statusCallbackUrl="${a(s.statusUrl)}" statusCallbackMethod="POST" extraHeaders="token=${a(s.sessionToken)}">${a(s.wsUrl)}</Stream>`
    case "recordSession":
      return `<Record recordSession="true" redirect="false" fileFormat="mp3" recordChannelType="stereo" maxLength="${MAX_CALL_SECONDS}" callbackUrl="${a(s.callbackUrl)}" callbackMethod="POST"/>`
    case "redirect":
      return `<Redirect method="POST">${a(s.url)}</Redirect>`
    case "hangup":
      return `<Hangup/>`
  }
}
```

- `Record` defaults: `maxLength=60` seconds and `fileFormat=mp3`. Always set `maxLength`
  explicitly for session recordings (`VERIFY` how `maxLength` interacts with
  `recordSession`).
- `extraHeaders` allows only `A-Z a-z 0-9` and `=`/`;` separators (max 512 bytes). Encode the
  stream token as hex (see [file 01 §11.2](./01-architecture-and-contracts.md#112-stream-session-token)).
- The default stream `contentType` is `audio/x-l16;rate=8000`. Set μ-law explicitly so both
  providers deliver the same codec to your AI agent.

### Parsing voice callbacks

```ts
function parseInboundCall(v, route): InboundCall {
  const p = v.params
  return {
    providerCallId: p.CallUUID,
    channel: route, // route decides pstn vs whatsapp
    from: normalizeE164(p.From),
    to: normalizeE164(p.To),
    callerName: p.CallerName,
  }
}
const PL_CALL = {
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  timeout: "no_answer",
  failed: "failed",
  cancel: "canceled",
  canceled: "canceled",
}
function parseCallStatus(v): CallStatusEvent {
  // hangup_url and ring_url
  const p = v.params
  return {
    providerCallId: p.CallUUID,
    providerRequestId: p.RequestUUID, // VERIFY RequestUUID on API-originated calls
    status: PL_CALL[p.CallStatus],
    durationSec: num(p.Duration),
    billedSec: num(p.BillDuration),
    hangupCause: p.HangupCauseName ?? p.HangupCause,
  }
}
function parseDialResult(v) {
  // VERIFY names: DialStatus / DialBLegUUID / DialBLegDuration family
  const p = v.params
  return {
    providerCallId: p.CallUUID,
    childCallId: p.DialBLegUUID,
    answered: p.DialStatus === "completed" || p.DialBLegStatus === "answer",
    childStatus: p.DialStatus ?? p.DialBLegStatus,
    childDurationSec: num(p.DialBLegDuration),
  }
}
function parseRecordingReady(v) {
  const p = v.params
  return {
    providerCallId: p.CallUUID,
    providerRecordingId: p.RecordingID,
    durationSec: num(p.RecordingDuration),
    channels: 2,
    url: p.RecordUrl,
  }
}
function parseDigits(v) {
  return { callId: v.params.CallUUID, digits: v.params.Digits ?? "" }
}
```

### Outbound calls and live-call control

```ts
async function placeCall(c: PlaceCallInput) {
  const body = {
    from: plivoNumber(c.from),
    to: plivoNumber(c.to),
    answer_url:
      origin() +
      "/webhooks/plivo/voice/outbound-connect?staff=" +
      encodeURIComponent(c.staffIdentity) +
      "&call=" +
      c.internalCallId,
    answer_method: "POST",
    ring_url: origin() + "/webhooks/plivo/voice/ring",
    hangup_url: origin() + "/webhooks/plivo/voice/hangup",
    fallback_url: origin() + "/webhooks/plivo/voice/fallback",
    ring_timeout: 25,
    time_limit: c.maxSeconds ?? 3600,
    ...(c.channel === "whatsapp" ? { call_type: "whatsapp_voice" } : {}), // VERIFY: API ref says whatsapp_voice; a concept page uses "whatsapp"
  }
  // The response has request_uuid, NOT the call UUID. Store it as providerRequestId and
  // bind the CallUUID when the first ring/answer/hangup callback carries RequestUUID.
  return classifyPlivo(
    await plivoApi("POST", "/Call/", body),
    (b) => b.request_uuid
  )
}

async function hangupCall(callUuid) {
  await plivoApi("DELETE", `/Call/${callUuid}/`)
}
async function redirectCall(callUuid, url) {
  await plivoApi("POST", `/Call/${callUuid}/`, {
    legs: "aleg",
    aleg_url: url,
    aleg_method: "POST",
  })
}
async function fetchRecording(rec) {
  const meta = json.parse(
    (await plivoApi("GET", `/Recording/${rec.providerRecordingId}/`)).body
  )
  assertHost(meta.recording_url, ["media.plivo.com"]) // SSRF guard; VERIFY host list
  return http.request("GET", meta.recording_url, {
    headers: { authorization: basicAuthPlivo() },
    stream: true,
  })
}
async function deleteRecording(rec) {
  await plivoApi("DELETE", `/Recording/${rec.providerRecordingId}/`)
}
```

### Browser calling (Plivo Browser SDK)

Each staff member is a Plivo **Endpoint** (a SIP user) attached to the browser-outbound
application.

- **Inbound to staff:** the router renders `dialBrowser(identity)` →
  `<User>sip:{endpointUsername}@phone.plivo.com</User>`.
- **Outbound from the browser:** the SDK calls a number. Plivo requests the endpoint
  application's Answer URL with `From = sip:{username}@phone.plivo.com` and `To = dialled
number`. Validate both, then render `dialNumber(to, callerId = business number)`.

```ts
async function issueBrowserToken(identity: string, ttlSec = 3600) {
  // Prefer a short-lived JWT access token over sending the endpoint password to the browser.
  // VERIFY the token API path and claim names in Plivo's Browser SDK "access token" docs.
  // Shape at research time: subject = endpoint username, voice incoming/outgoing permissions,
  // app = PLIVO_BROWSER_APP_ID, expiry.
  const res = await plivoApi("POST", "/JWT/Token/", {
    iss: env("PLIVO_AUTH_ID"),
    sub: identity,
    exp: Math.floor(clock.now() / 1000) + ttlSec,
    per: { voice: { incoming_allow: true, outgoing_allow: true } },
    app: env("PLIVO_BROWSER_APP_ID"),
  })
  return {
    token: json.parse(res.body).token,
    expiresAt: Math.floor(clock.now() / 1000) + ttlSec,
  }
}

function browserOutbound(v) {
  const staff = /^sip:([^@]+)@/.exec(v.params.From ?? "")?.[1]
  const to = normalizeE164(v.params.To)
  if (!staff || !isActiveStaff(staff) || !isAllowedDestination(to))
    return render([say("This call is not allowed."), hangup()])
  recordCallIntent({
    providerCallId: v.params.CallUUID,
    staff,
    to,
    direction: "out",
  })
  return render([
    {
      op: "dialNumber",
      to,
      callerId: env("BUSINESS_NUMBER_E164"),
      timeoutSec: 30,
      actionUrl: origin() + "/webhooks/plivo/voice/dial-complete",
    },
  ])
}
```

## 6. AI agent: audio stream codec

```ts
const plivoStreamCodec: StreamCodec = {
  decode(frame) {
    const m = json.parse(frame)
    switch (m.event) {
      case "start":
        return {
          type: "start",
          providerCallId: m.start.callId,
          streamId: m.start.streamId,
          sessionToken: tokenFromExtraHeaders(m.extra_headers),
          encoding: m.start.mediaFormat.encoding.includes("mulaw")
            ? "mulaw"
            : "l16",
          sampleRate: Number(m.start.mediaFormat.sampleRate),
        }
      case "media":
        return {
          type: "audio",
          payload: fromBase64(m.media.payload),
          timestampMs: Number(m.media.timestamp),
        }
      case "dtmf":
        return { type: "dtmf", digit: m.dtmf.digit }
      case "playedStream":
        return { type: "mark_done", name: m.name } // reply to our "checkpoint"
      case "clearedAudio":
        return null
      case "stop":
        return { type: "stop" } // VERIFY stop payload
    }
    return null
  },
  encode(msg, ctx) {
    switch (msg.type) {
      case "audio":
        return json.stringify({
          event: "playAudio",
          media: {
            contentType: "audio/x-mulaw",
            sampleRate: 8000,
            payload: base64(msg.payload),
          },
        }) // must match <Stream contentType>
      case "mark":
        return json.stringify({
          event: "checkpoint",
          streamId: ctx.streamId,
          name: msg.name,
        })
      case "clear":
        return json.stringify({ event: "clearAudio", streamId: ctx.streamId })
    }
  },
  sessionTokenFrom(start) {
    return start.sessionToken
  },
}
// extra_headers arrives as "token=abc;k=v" or as an object. VERIFY, and accept both.
function tokenFromExtraHeaders(h) {
  if (!h) return null
  if (typeof h === "object") return h.token ?? null
  return (
    Object.fromEntries(
      String(h)
        .split(";")
        .map((kv) => kv.split("="))
    ).token ?? null
  )
}
```

Hand-over: end the stream (close the WebSocket, or stop it through the Audio Streams API).
Because `keepCallAlive="true"`, Plivo continues to the `<Redirect>` after `<Stream>`, which
calls `/voice/after-agent`. `VERIFY` that closing the socket from the server side continues the
XML on your account. If it does not, use `redirectCall()`.

Audio streaming and noise cancellation are **included in the per-minute price** on Plivo
(Twilio Media Streams costs USD 0.0044/min extra).

## 7. WhatsApp calling

```ts
// Inbound: Answer URL /webhooks/plivo/whatsapp/voice/answer (set on the WhatsApp number).
// Route by path -> channel "whatsapp". Return dialBrowser(...) (an Endpoint) or a SIP URI. Never <Number>:
// WhatsApp calls cannot be forwarded to the PSTN, or WhatsApp-to-WhatsApp.

// Outbound (after the permission checks in file 01 §14), either:
placeCall({
  channel: "whatsapp",
  from: env("PLIVO_WHATSAPP_NUMBER"),
  to: customer.e164,
  staffIdentity,
})
// or, within an existing call flow: render dialWhatsApp(...) -> <Dial callType="whatsapp"><User>61…</User></Dial>
```

Plivo limits on the research date: up to **1,000 simultaneous calls per WhatsApp number**;
account CPS (calls per second) limits apply; business-initiated calls are not available from
business numbers in the US, Canada, Turkey, Egypt, Nigeria or Vietnam (AU numbers are fine).

**Permission request:** send an approved **calling permissions request** template (category
Marketing or Utility) through `sendMessage` with `template`. Alternatively, if callback
permission is enabled in Meta Business Manager, a user who calls you first grants temporary
permission. Capture the permission reply webhook as a fixture.

## 8. Plivo-specific gotchas

- **Numbers without `+`:** callbacks and examples use `61412345678`. Always run
  `normalizeE164` before comparing or storing.
- **`request_uuid` ≠ `CallUUID`:** outbound API calls must be correlated through the request
  UUID. If you skip this, outbound calls appear as unknown inbound activity.
- **Answer URL failure:** after 3 retries or 60 s, Plivo uses the fallback URL. Keep the
  answer handler fast and the fallback static.
- **Sub-accounts:** a number in a sub-account signs with the sub-account token. Verify against
  the token of the account that owns the number. `X-Plivo-Signature-Ma-V3` is always signed
  with the main account token.
- **WhatsApp platform fee:** USD 10/month per WABA plus USD 0.001 per message in and out, on
  top of Meta fees.
- **Docs drift:** several Plivo pages disagree (WhatsApp calling setup, `call_type` value,
  stream event names). Fixtures beat docs.
