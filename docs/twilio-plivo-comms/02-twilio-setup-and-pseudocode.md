# 2. Twilio: setup and adapter pseudocode (AU)

Implements the [`CommsProvider` port](./01-architecture-and-contracts.md#4-the-commsprovider-port)
with raw HTTPS. No Twilio SDK required. Rates are in [file 04](./04-au-cost-comparison.md).

## 1. Account and console setup

Do these in order. Use a separate **subaccount per environment** (dev, staging, prod) so that
numbers, keys and webhooks never cross over.

| #   | Step                         | Details                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Upgrade account              | Add business details, MFA, billing, balance alert and an auto-recharge ceiling. Trial accounts can only call verified numbers.                                                                                                                                                                                                                                                                               |
| 2   | Choose region                | Default **US1** (`api.twilio.com`). **AU1** (`api.sydney.au1.twilio.com`) keeps data processing in Australia but needs **region-specific API keys and Auth Token**, and not every product is available there. Earlier research for this repo found the WhatsApp sender's voice application binds to US1. `VERIFY` per product before choosing AU1.                                                           |
| 3   | Regulatory bundle            | Console → Phone Numbers → Regulatory Compliance → create a **Business** bundle for AU **Mobile** numbers. Needs business identity and an Australian street address (no PO box) for voice + SMS. Review takes days.                                                                                                                                                                                           |
| 4   | Buy the number               | Buy an **AU mobile number** (`+614…`), assigned to the bundle. AU **local** (`+612/3/7/8…`) numbers are **voice-only** and cannot send SMS or be a reliable WhatsApp sender. Use a local or toll-free number only for voice.                                                                                                                                                                                 |
| 5   | API key                      | Console → API keys → create a **Standard** key. It is used for REST Basic auth **and** for signing browser Access Tokens. Restricted keys cannot sign Voice tokens. Keep the **Auth Token** too: it signs webhooks.                                                                                                                                                                                          |
| 6   | TwiML App (browser outbound) | Console → Voice → TwiML Apps → Voice URL `POST {origin}/webhooks/twilio/voice/browser-outbound`, Status Callback `{origin}/webhooks/twilio/voice/status`.                                                                                                                                                                                                                                                    |
| 7   | Number voice config          | A call comes in → Webhook `POST {origin}/webhooks/twilio/voice/inbound`. Primary handler fails → `POST {origin}/webhooks/twilio/voice/fallback`. Call status changes → `{origin}/webhooks/twilio/voice/status`.                                                                                                                                                                                              |
| 8   | Number messaging config      | A message comes in → `POST {origin}/webhooks/twilio/sms/inbound`. Optional: put the number in a **Messaging Service** for sticky sender and an inbound URL in one place.                                                                                                                                                                                                                                     |
| 9   | WhatsApp sender              | Console → Messaging → Senders → WhatsApp senders → **Self Sign-up** (Meta embedded signup). Needs a Meta Business portfolio, a display name approved by Meta, and a number that **is not active on the WhatsApp app** and can receive the OTP. The AU mobile from step 4 works. Set Incoming URL `{origin}/webhooks/twilio/whatsapp/inbound` and Status callback `{origin}/webhooks/twilio/messages/status`. |
| 10  | Meta Business verification   | Complete it in Meta Business Manager. It raises messaging limits and is needed for calling eligibility.                                                                                                                                                                                                                                                                                                      |
| 11  | WhatsApp templates           | Console → Messaging → Content Template Builder (or Content API). Create templates and submit them for WhatsApp approval. Store each template's `ContentSid`, category and language in your `Template` table.                                                                                                                                                                                                 |
| 12  | WhatsApp Business Calling    | Enable calling on the sender and point its voice handler to `POST {origin}/webhooks/twilio/whatsapp/voice/inbound` (Senders API/Console, `VERIFY` exact field). In Meta Business Manager, set call hours, the call icon, and **callback permission** if you want callers to grant permission automatically.                                                                                                  |
| 13  | Usage alerts                 | Console → Usage → Triggers. Daily spend triggers per category (calls, SMS, WhatsApp).                                                                                                                                                                                                                                                                                                                        |

### Environment variables

```
TWILIO_ACCOUNT_SID          = AC…            # subaccount SID for this environment
TWILIO_API_KEY_SID          = SK…            # Standard key
TWILIO_API_KEY_SECRET       = …
TWILIO_AUTH_TOKEN           = …              # webhook signature validation
TWILIO_AUTH_TOKEN_PREVIOUS  = …              # optional, during rotation
TWILIO_TWIML_APP_SID        = AP…            # browser outbound
TWILIO_REGION               = us1 | au1
TWILIO_WHATSAPP_SENDER      = +61…           # usually BUSINESS_NUMBER_E164
STREAM_TOKEN_SECRET         = 32+ random bytes
```

### Route table

| Method | Path                                      | Purpose                                 | Response             |
| ------ | ----------------------------------------- | --------------------------------------- | -------------------- |
| POST   | `/webhooks/twilio/sms/inbound`            | Inbound SMS                             | `204` or empty TwiML |
| POST   | `/webhooks/twilio/whatsapp/inbound`       | Inbound WhatsApp message / button reply | `204`                |
| POST   | `/webhooks/twilio/messages/status`        | SMS + WhatsApp delivery/read status     | `204`                |
| POST   | `/webhooks/twilio/voice/inbound`          | Inbound PSTN call                       | TwiML                |
| POST   | `/webhooks/twilio/voice/fallback`         | Primary handler failed                  | TwiML (static, safe) |
| POST   | `/webhooks/twilio/whatsapp/voice/inbound` | Inbound WhatsApp call                   | TwiML                |
| POST   | `/webhooks/twilio/voice/browser-outbound` | TwiML App: staff dialled from browser   | TwiML                |
| POST   | `/webhooks/twilio/voice/outbound-connect` | Customer-first REST call answered       | TwiML                |
| POST   | `/webhooks/twilio/voice/consent`          | Gather result for recording consent     | TwiML                |
| POST   | `/webhooks/twilio/voice/dial-complete`    | `<Dial action>` result                  | TwiML                |
| POST   | `/webhooks/twilio/voice/after-agent`      | AI stream ended → hand-over             | TwiML                |
| POST   | `/webhooks/twilio/voice/status`           | Call status callbacks                   | `204`                |
| POST   | `/webhooks/twilio/voice/recording`        | Recording status callback               | `204`                |
| POST   | `/webhooks/twilio/voice/stream-status`    | Media Stream status callback            | `204`                |
| GET→WS | `/ws/twilio/voice-agent`                  | Media Streams WebSocket                 | upgrade              |

## 2. Webhook signature (`X-Twilio-Signature`)

Algorithm: HMAC-SHA1, keyed with the Auth Token, over the **full public URL** (including the
query string) followed by every POST field as `key + value`, with keys sorted. Base64 output.

```ts
function verifyTwilioWebhook(req): VerifiedRequest | null {
  const sig = req.headers["x-twilio-signature"]
  if (!sig) return null
  const raw = readBodyCapped(req, 64 * 1024)
  const url = env("COMMS_WEBHOOK_ORIGIN") + req.path + req.rawQuery // exactly as Twilio called it
  let params: Record<string, string> = {}
  let data: string

  if (
    req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
  ) {
    params = formDecode(raw) // repeated keys: see note
    data =
      url +
      Object.keys(params)
        .sort()
        .map((k) => k + params[k])
        .join("")
  } else if (req.headers["content-type"]?.startsWith("application/json")) {
    // JSON webhooks: the URL carries bodySHA256; the signature covers the URL only.
    const bodyHash = new URL(url).searchParams.get("bodySHA256")
    if (!bodyHash || !timingSafeEqual(bodyHash, hex(sha256(raw)))) return null
    data = url
    params = json.parse(raw)
  } else return null

  const tokens = [
    env("TWILIO_AUTH_TOKEN"),
    env("TWILIO_AUTH_TOKEN_PREVIOUS"),
  ].filter(Boolean)
  const ok = tokens.some((t) => timingSafeEqual(sig, base64(hmacSha1(t, data))))
  if (!ok) return null
  if (params.AccountSid && params.AccountSid !== env("TWILIO_ACCOUNT_SID"))
    return null
  return { provider: "twilio", params, rawUrl: url }
}
```

Notes:

- Repeated form keys (for example `StatusCallbackEvent`) are concatenated as `key+value` for
  each value, in order, after the key sort.
- If the server runs on a non-default port, Twilio may sign the URL with or without the port.
  Try both forms.
- The **WebSocket upgrade** for Media Streams is also signed: verify `X-Twilio-Signature`
  over the `wss://…` URL with no params. Some proxies report `https://`, so try both schemes.

**Test vectors** (verified with the official `twilio` helper):

| Auth token        | URL                                                 | Params                                                                                            | Expected signature             |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `12345`           | `https://mycompany.com/myapp.php?foo=1&bar=2`       | `CallSid=CA1234567890ABCDE, Caller=+12349013030, Digits=1234, From=+12349013030, To=+18005551212` | `0/KCTR6DLpKmkAf8muzZqo1nDgQ=` |
| `test_auth_token` | `https://example.com/webhooks/twilio/voice/inbound` | `AccountSid=ACtest, CallSid=CAtest, From=+61412345678, To=+61298765432`                           | `hdOffivWMe6gRZ4iKUrYr6FfFb0=` |

## 3. REST client

```ts
function twilioBase() {
  return env("TWILIO_REGION") === "au1"
    ? "https://api.sydney.au1.twilio.com"
    : "https://api.twilio.com"
}
async function twilioApi(
  method,
  path,
  form?: Record<string, string | string[]>
) {
  const res = await http.request(
    method,
    `${twilioBase()}/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}${path}`,
    {
      headers: {
        authorization:
          "Basic " +
          base64(
            env("TWILIO_API_KEY_SID") + ":" + env("TWILIO_API_KEY_SECRET")
          ),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form ? formEncode(form) : undefined, // arrays -> repeated keys
      timeoutMs: 10_000,
    }
  )
  return res
}

function classify(res, idField = "sid"): Accepted | Rejected | Uncertain {
  if (res.error /* timeout, reset */)
    return { kind: "uncertain", reason: res.error }
  if (res.status >= 200 && res.status < 300)
    return { kind: "accepted", providerId: json.parse(res.body)[idField] }
  if (res.status === 429)
    return { kind: "rejected", code: "RATE_LIMIT", retryable: true } // not accepted; safe to retry later
  if (res.status >= 400 && res.status < 500)
    return {
      kind: "rejected",
      code: String(json.parse(res.body).code),
      retryable: false,
    }
  return { kind: "uncertain", reason: "HTTP " + res.status }
}
```

## 4. Messaging (SMS and WhatsApp)

```ts
async function sendMessage(m: SendMessageInput) {
  const wa = m.channel === "whatsapp"
  const addr = (e164) => (wa ? "whatsapp:" + e164 : e164)
  const form: Record<string, any> = {
    From: addr(m.from), // business number
    To: addr(m.to),
    StatusCallback: origin() + "/webhooks/twilio/messages/status",
  }
  if (m.template) {
    // WhatsApp template outside the 24h window
    form.ContentSid = m.template.providerTemplateRef // HX…
    form.ContentVariables = json.stringify(m.template.variables) // {"1":"Sam","2":"Tuesday"}
  } else {
    form.Body = m.body
  }
  if (m.mediaUrls?.length) form.MediaUrl = m.mediaUrls // public HTTPS, short-lived signed URLs
  return classify(await twilioApi("POST", "/Messages.json", form)) // providerId = SM…/MM…
}
```

Common rejection codes to map to user-facing reasons: `21211` invalid `To`, `21610` recipient
unsubscribed (STOP), `21408` region not enabled, `63016` WhatsApp free-form outside the 24 h
window, `63032` the user blocked or opted out of business messages.

### Parsing inbound and status

```ts
function parseInboundMessage(v): InboundMessage {
  const p = v.params
  const wa = p.From.startsWith("whatsapp:")
  const n = Number(p.NumMedia ?? 0)
  return {
    providerMessageId: p.MessageSid,
    channel: wa ? "whatsapp" : "sms",
    from: normalizeE164(p.From),
    to: normalizeE164(p.To),
    body: p.Body ?? "",
    media: range(n).map((i) => ({
      url: p["MediaUrl" + i],
      contentType: p["MediaContentType" + i],
    })),
    waButtonPayload: p.ButtonPayload, // quick-reply / permission button
    receivedAt: clock.now(),
  }
}
// Twilio media URLs require Basic auth to download. Copy to blob storage in a job, then
// DELETE /Messages/{MessageSid}/Media/{MediaSid}.json if you do not want Twilio to keep it.

const TW_MSG_STATUS = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  undelivered: "undelivered",
  failed: "failed",
  canceled: "failed",
  receiving: null,
  received: null,
}
function parseMessageStatus(v): MessageStatusEvent {
  return {
    providerMessageId: v.params.MessageSid,
    status: TW_MSG_STATUS[v.params.MessageStatus],
    errorCode: v.params.ErrorCode,
  }
}
```

## 5. Voice

### TwiML renderer

```ts
function render(steps: CallInstruction[]) {
  // Fold streamToAgent + following redirect into <Connect action="…"> (see note below).
  const out: string[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i],
      next = steps[i + 1]
    if (s.op === "streamToAgent" && next?.op === "redirect") {
      out.push(r(s, next.url))
      i++
      continue
    }
    out.push(r(s))
  }
  return {
    contentType: "application/xml",
    body: `<?xml version="1.0" encoding="UTF-8"?><Response>${out.join("")}</Response>`,
  }
}
const a = (s) => xmlEscape(String(s))
function recAttrs(s) {
  return s.record === "from_answer_dual"
    ? ` record="record-from-answer-dual" recordingStatusCallback="${a(s.recordingCallbackUrl)}" recordingStatusCallbackEvent="completed"`
    : ""
}
function r(s: CallInstruction, connectAction?: string): string {
  switch (s.op) {
    case "say":
      return `<Say language="${s.language ?? "en-AU"}"${s.voice === "male" ? ' voice="man"' : ""}>${a(s.text)}</Say>`
    // Neural AU voices (e.g. voice="Polly.Olivia-Neural") cost extra per 100 chars.
    case "play":
      return `<Play>${a(s.url)}</Play>`
    case "pause":
      return `<Pause length="${s.seconds}"/>`
    case "gatherDigits":
      return `<Gather input="dtmf" numDigits="${s.numDigits}" timeout="${s.timeoutSec}" action="${a(s.actionUrl)}" method="POST">${s.prompt.map(r).join("")}</Gather>`
    case "dialNumber":
      return `<Dial callerId="${a(s.callerId)}" timeout="${s.timeoutSec}" action="${a(s.actionUrl)}" method="POST"${recAttrs(s)}><Number>${a(s.to)}</Number></Dial>`
    case "dialBrowser":
      return `<Dial timeout="${s.timeoutSec}" action="${a(s.actionUrl)}" method="POST"${s.callerId ? ` callerId="${a(s.callerId)}"` : ""}${recAttrs(s)}><Client><Identity>${a(s.staffIdentity)}</Identity></Client></Dial>`
    case "dialWhatsApp": // VERIFY noun content format against the <WhatsApp> TwiML reference
      return `<Dial callerId="whatsapp:${a(s.callerId)}" action="${a(s.actionUrl)}" method="POST"><WhatsApp>${a(s.to)}</WhatsApp></Dial>`
    case "streamToAgent": // Twilio continues at <Connect action> after your server closes the socket
      return `<Connect${connectAction ? ` action="${a(connectAction)}"` : ""}><Stream url="${a(s.wsUrl)}" statusCallback="${a(s.statusUrl)}"><Parameter name="token" value="${a(s.sessionToken)}"/></Stream></Connect>`
    case "recordSession": // VERIFY <Start><Recording>; fallback is REST start (below)
      return `<Start><Recording recordingStatusCallback="${a(s.callbackUrl)}" recordingStatusCallbackEvent="completed" recordingChannels="dual"/></Start>`
    case "redirect":
      return `<Redirect method="POST">${a(s.url)}</Redirect>`
    case "hangup":
      return `<Hangup/>`
  }
}
```

The renderer folds a `streamToAgent` followed by `redirect` into one
`<Connect action="{redirect url}">`. TwiML after `<Connect>` is not reached in the same way as
after other verbs.

### Parsing voice callbacks

```ts
function parseInboundCall(v, route): InboundCall {
  const p = v.params
  return {
    providerCallId: p.CallSid,
    channel: route, // channel comes from the route, not the payload
    from: normalizeE164(p.From),
    to: normalizeE164(p.To),
    callerName: p.CallerName,
  }
}
const TW_CALL = {
  queued: "ringing",
  initiated: "ringing",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
}
function parseCallStatus(v): CallStatusEvent {
  const p = v.params
  return {
    providerCallId: p.CallSid,
    status: TW_CALL[p.CallStatus],
    durationSec: num(p.CallDuration),
    billedSec: num(p.CallDuration),
  } // parent leg; ParentCallSid present on child legs
}
function parseDialResult(v) {
  // <Dial action>
  const p = v.params
  return {
    providerCallId: p.CallSid,
    childCallId: p.DialCallSid,
    answered:
      p.DialCallStatus === "completed" || p.DialCallStatus === "answered",
    childStatus: p.DialCallStatus,
    childDurationSec: num(p.DialCallDuration),
  }
}
function parseRecordingReady(v) {
  const p = v.params
  if (p.RecordingStatus !== "completed") return null // in-progress | absent | failed
  return {
    providerCallId: p.CallSid,
    providerRecordingId: p.RecordingSid,
    durationSec: num(p.RecordingDuration),
    channels: num(p.RecordingChannels),
  }
}
function parseDigits(v) {
  return { callId: v.params.CallSid, digits: v.params.Digits ?? "" }
}
```

### Outbound calls and live-call control

```ts
// Customer-first: call the customer; when they answer, ring the staff browser.
async function placeCall(c: PlaceCallInput) {
  const wa = c.channel === "whatsapp"
  const form = {
    From: wa ? "whatsapp:" + c.from : c.from,
    To: wa ? "whatsapp:" + c.to : c.to,
    Url:
      origin() +
      "/webhooks/twilio/voice/outbound-connect?staff=" +
      encodeURIComponent(c.staffIdentity) +
      "&call=" +
      c.internalCallId, // the query is part of the signed URL, so it cannot be tampered with
    Method: "POST",
    StatusCallback: origin() + "/webhooks/twilio/voice/status",
    StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    Timeout: "25",
    TimeLimit: String(c.maxSeconds ?? 3600),
  }
  return classify(await twilioApi("POST", "/Calls.json", form)) // providerId = CA…
}
// outbound-connect returns: [say("Connecting you now."), dialBrowser(staff)]
// For WhatsApp: error 37006 = the 24h connected-call quota or permission window was exceeded.

async function hangupCall(callSid) {
  await twilioApi("POST", `/Calls/${callSid}.json`, { Status: "completed" })
}
async function redirectCall(callSid, url) {
  await twilioApi("POST", `/Calls/${callSid}.json`, {
    Url: url,
    Method: "POST",
  })
}
async function startRecording(callSid) {
  // REST alternative to <Start><Recording>
  await twilioApi("POST", `/Calls/${callSid}/Recordings.json`, {
    RecordingChannels: "dual",
    RecordingStatusCallback: origin() + "/webhooks/twilio/voice/recording",
    RecordingStatusCallbackEvent: "completed",
  })
}
async function fetchRecording(rec) {
  // authenticated download; build the URL from the SID, never from the callback
  return http.request(
    "GET",
    `${twilioBase()}/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Recordings/${rec.providerRecordingId}.wav`,
    { headers: { authorization: basicAuth() }, stream: true }
  )
}
async function deleteRecording(rec) {
  await twilioApi("DELETE", `/Recordings/${rec.providerRecordingId}.json`)
}
```

### Browser calling (Voice JS SDK) token without the SDK

```ts
async function issueBrowserToken(identity: string, ttlSec = 3600) {
  const now = Math.floor(clock.now() / 1000)
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" }
  const payload = {
    jti: `${env("TWILIO_API_KEY_SID")}-${now}`,
    iss: env("TWILIO_API_KEY_SID"),
    sub: env("TWILIO_ACCOUNT_SID"),
    nbf: now,
    exp: now + ttlSec,
    grants: {
      identity, // [A-Za-z0-9_], e.g. "staff_42"
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: env("TWILIO_TWIML_APP_SID") },
      },
    },
  }
  const unsigned =
    base64url(json.stringify(header)) + "." + base64url(json.stringify(payload))
  return {
    token:
      unsigned +
      "." +
      base64url(hmacSha256(env("TWILIO_API_KEY_SECRET"), unsigned)),
    expiresAt: now + ttlSec,
  }
}
```

The browser then uses `new Device(token, { edge: "sydney" })`. `edge: "sydney"` gives the
lowest media latency from Australia and is independent of the REST region.

```ts
// TwiML App Voice URL: the browser called Device.connect({ params: { To: "+614…" } })
function browserOutbound(v) {
  const staff = v.params.From?.replace(/^client:/, "") // identity from our signed token
  const to = normalizeE164(v.params.To)
  if (!staff || !isActiveStaff(staff) || !isAllowedDestination(to))
    return render([say("This call is not allowed."), hangup()])
  recordCallIntent({
    providerCallId: v.params.CallSid,
    staff,
    to,
    direction: "out",
  }) // fast insert
  return render([
    {
      op: "dialNumber",
      to,
      callerId: env("BUSINESS_NUMBER_E164"),
      timeoutSec: 30,
      actionUrl: origin() + "/webhooks/twilio/voice/dial-complete",
    },
  ])
}
```

## 6. AI agent: Media Streams codec

Twilio sends `audio/x-mulaw`, 8000 Hz, mono, base64, roughly 20 ms per frame.

```ts
const twilioStreamCodec: StreamCodec = {
  decode(frame) {
    const m = json.parse(frame)
    switch (m.event) {
      case "connected":
        return null
      case "start":
        return {
          type: "start",
          providerCallId: m.start.callSid,
          streamId: m.start.streamSid,
          sessionToken: m.start.customParameters?.token,
          encoding: "mulaw",
          sampleRate: 8000,
        }
      case "media":
        return m.media.track === "inbound" || !m.media.track
          ? {
              type: "audio",
              payload: fromBase64(m.media.payload),
              timestampMs: Number(m.media.timestamp),
            }
          : null
      case "dtmf":
        return { type: "dtmf", digit: m.dtmf.digit }
      case "mark":
        return { type: "mark_done", name: m.mark.name }
      case "stop":
        return { type: "stop" }
    }
    return null
  },
  encode(msg, ctx) {
    switch (msg.type) {
      case "audio":
        return json.stringify({
          event: "media",
          streamSid: ctx.streamId,
          media: { payload: base64(msg.payload) },
        })
      case "mark":
        return json.stringify({
          event: "mark",
          streamSid: ctx.streamId,
          mark: { name: msg.name },
        })
      case "clear":
        return json.stringify({ event: "clear", streamSid: ctx.streamId })
    }
  },
  sessionTokenFrom(start) {
    return start.sessionToken
  },
}
```

Hand-over: close the WebSocket from your server. Twilio then requests the `<Connect action>`
URL (`/voice/after-agent`), which returns `dialStaff(...)`.

**ConversationRelay alternative:** `<Connect><ConversationRelay url="wss://…">` lets Twilio do
STT/TTS and sends you text instead of audio. It is simpler, but costs **USD 0.07/min** compared
with USD 0.0044/min for Media Streams. Plivo has no equivalent. To stay portable across
providers, build on raw audio streams.

## 7. WhatsApp calling

```ts
// Inbound: the WhatsApp sender's voice handler -> /webhooks/twilio/whatsapp/voice/inbound
// From = "whatsapp:+61…". Route by path: channel = "whatsapp".
// Router returns dialBrowser(...) or a SIP dial. Never dialNumber: WhatsApp calls cannot reach the PSTN.
// A customer-initiated call also opens the 24h messaging window and, if callback permission
// is enabled in Meta, grants temporary call permission. Record both.

// Outbound: after the permission checks in file 01 §14
placeCall({
  channel: "whatsapp",
  from: env("TWILIO_WHATSAPP_SENDER"),
  to: customer.e164,
  staffIdentity,
})
```

**Permission request:** send the call-permission-request content type that Twilio documents
for Business Calling, as a Content template (`VERIFY` the content type name and approval
category). The reply arrives on `/webhooks/twilio/whatsapp/inbound` as an interactive/button
reply. Capture one real reply as a fixture and map it in `applyPermissionReply`.

## 8. Twilio-specific gotchas

- **Signature URL mismatches** are the top setup bug. Log the URL you checked (never the
  token) on failure.
- **AU local numbers cannot send SMS.** Use a mobile number for two-way SMS.
- **Child legs:** `<Dial>` creates a child call with its own `CallSid` and `ParentCallSid`.
  Bill and attribute from the parent.
- **Recordings** from `<Dial record>` with `record-from-answer-dual` give the two parties in
  separate channels. That is useful for transcription.
- **Fallback URL** should return static, safe TwiML (for example: apologise and dial the
  staff phone) with no DB dependency.
- **Concurrency/CPS:** new accounts have a low outbound CPS (calls per second). Queue
  outbound calls; do not fan out.
- **Auth Token rotation:** promote the secondary token in the console only after deploying
  `TWILIO_AUTH_TOKEN_PREVIOUS`.
