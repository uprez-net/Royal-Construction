# 1. Provider-neutral architecture and contracts

> Provider names in this file are written "twilio" | "plivo". **Telnyx is a third adapter**
> ([file 07](./07-telnyx-setup-and-pseudocode.md)); read
> [file 06](./06-provider-agnostic-architecture.md) for how these contracts apply to this
> repository, the capability model and the factory. Where a snippet says
> `"twilio" | "plivo"`, read `"twilio" | "plivo" | "telnyx"`. Two models of call control
> exist: markup (Twilio, Plivo) and REST commands (Telnyx); `render` applies to the first,
> and a command adapter executes the same DSL against a live call instead.

Build this layer before any provider adapter. Business logic (CRM, inbox, AI agent,
routing rules) talks only to these contracts. A provider adapter
([Twilio](./02-twilio-setup-and-pseudocode.md), [Plivo](./03-plivo-setup-and-pseudocode.md))
translates between the contracts and the provider's wire format. Switching providers then
means adding an adapter, not rewriting features.

```
            ┌──────────────────────── your application ────────────────────────┐
 customer   │  webhook routes ──► verify ──► normalize ──► ledger ──► workers   │
 ─────────► │      ▲                (adapter)  (adapter)    (neutral) (neutral)  │
 provider   │      │                                                    │        │
 ◄───────── │  call markup ◄── render(DSL) ◄── call router ◄────────────┘        │
            │  REST calls  ◄── adapter.send*/placeCall ◄── outbox worker         │
            │  audio WS    ◄──► adapter.streamCodec ◄──► AI voice agent          │
            └────────────────────────────────────────────────────────────────────┘
```

## 1. Primitives the host project must supply

The pseudocode uses only these. Map each one to what the project already has.

| Primitive                                       | Meaning                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `http.request(method, url, {headers, body})`    | Any HTTPS client. Returns `{status, headers, body}`. Must support timeouts.                                       |
| `hmacSha1(key, msg)`, `hmacSha256(key, msg)`    | Raw bytes out. UTF-8 in.                                                                                          |
| `base64(bytes)`, `base64url(bytes)`             | Standard and URL-safe, no padding for `base64url`.                                                                |
| `timingSafeEqual(a, b)`                         | Constant-time string/bytes compare.                                                                               |
| `json.parse/stringify`, `formDecode/formEncode` | `application/json` and `application/x-www-form-urlencoded`.                                                       |
| `xmlEscape(text)`                               | Escapes `& < > " '` for XML text and attributes.                                                                  |
| `ws.server(path, onOpen)`                       | WebSocket server endpoint (for AI audio). Needs an always-on host or a platform that supports WebSocket upgrades. |
| `db.tx(fn)`, unique constraints                 | Any transactional store with unique indexes.                                                                      |
| `queue.enqueue(job, {runAt})`, worker loop      | Any durable job queue or a DB outbox table polled by a worker.                                                    |
| `blob.putPrivate(key, stream)`                  | Private object storage for recordings and media.                                                                  |
| `clock.now()`, `uuid()`                         | Wall clock (UTC) and random IDs.                                                                                  |
| `env(name)`                                     | Secret/config lookup. Never log values.                                                                           |

## 2. Configuration

```
COMMS_PROVIDER              = "twilio" | "plivo" | "telnyx" # new outbound work (this repo: COMMUNICATIONS_PROVIDER)
COMMS_WEBHOOK_ORIGIN        = "https://app.example.com"   # exact public origin providers call; used in signatures
BUSINESS_NUMBER_E164        = "+61…"                       # AU mobile number: voice + SMS (+ WhatsApp sender)
STAFF_FORWARD_E164          = "+61…"                       # optional: staff mobile/landline for bridged calls
DEFAULT_TIMEZONE            = "Australia/Sydney"           # quiet hours, business hours
RECORDING_MODE              = "off" | "consented"
WHATSAPP_ENABLED            = true | false
WHATSAPP_CALLING_ENABLED    = true | false
AI_AGENT_ENABLED            = true | false
AI_AGENT_WS_PATH            = "/ws/voice-agent"
# provider secrets: see the adapter files
```

**Inbound webhooks route by provider in the path** (`/webhooks/twilio/...`,
`/webhooks/plivo/...`), so both adapters can run at once during a migration. Inbound events
are always handled by whichever provider sent them. `COMMS_PROVIDER` only selects the
provider for **new outbound** work.

## 3. Data model

Use these tables (or documents). The names are suggestions. The unique keys are required.

```
Contact            id, displayName, createdAt
ChannelIdentity    id, contactId, kind ("phone" | "whatsapp"), e164, verifiedAt
                   UNIQUE(kind, e164)

Conversation       id, contactId, channel ("sms" | "whatsapp" | "voice"), businessAddress, lastInboundAt
                   # lastInboundAt drives the WhatsApp 24-hour window

Message            id, conversationId, direction ("in" | "out"), channel, body, mediaRefs[],
                   templateRef?, status, errorCode?, provider, providerMessageId?,
                   idempotencyKey, createdAt, statusUpdatedAt
                   UNIQUE(provider, providerMessageId)   # null allowed until accepted
                   UNIQUE(idempotencyKey)

Call               id, contactId?, channel ("pstn" | "whatsapp"), direction ("in" | "out"),
                   fromE164, toE164, businessAddress, status, provider, providerCallId?,
                   providerRequestId?, parentCallId?, answeredBy ("ai" | "staff" | "none"),
                   startedAt, answeredAt?, endedAt?, durationSec?, billedSec?, hangupCause?,
                   recordingConsent ("unknown" | "granted" | "declined"), idempotencyKey
                   UNIQUE(provider, providerCallId)
                   UNIQUE(provider, providerRequestId)   # Plivo outbound correlation
                   UNIQUE(idempotencyKey)

Recording          id, callId, provider, providerRecordingId, status, durationSec,
                   channels, privateBlobKey?, providerDeletedAt?
                   UNIQUE(provider, providerRecordingId)

WebhookDelivery    id, provider, kind, dedupeKey, receivedAt, processedAt?, attempts,
                   payload (redacted JSON), lastError?
                   UNIQUE(provider, dedupeKey)

OutboxJob          id, kind ("send_message" | "place_call" | "hangup" | "fetch_recording" | ...),
                   payload, provider, runAt, attempts, state, lastError?

Consent            id, contactId, channel, purpose ("marketing" | "recording" | "wa_call"),
                   state ("granted" | "revoked" | "declined"), evidence, capturedAt, expiresAt?

WhatsAppCallPermission  id, contactId, businessAddress, state ("none" | "requested" |
                   "granted" | "rejected" | "revoked"), requestedAt[], grantedAt?, expiresAt?,
                   callsInWindow[], providerEvidence

Template           id, provider, name, language, category ("marketing" | "utility" |
                   "authentication"), providerTemplateRef (Twilio ContentSid | Plivo name),
                   variables[], approvalStatus
```

## 4. The `CommsProvider` port

Each adapter implements this interface. All inputs and outputs are neutral types. No
provider field name leaks past the adapter.

```ts
type E164 = string // always "+61…" after normalize
type Channel = "sms" | "whatsapp"
type CallChannel = "pstn" | "whatsapp"

interface VerifiedRequest {
  // produced only by verifyWebhook
  provider: "twilio" | "plivo"
  params: Record<string, string> // decoded form/query/JSON fields
  rawUrl: string // public URL that was signed
}

interface CommsProvider {
  name: "twilio" | "plivo"

  // ---- inbound HTTP
  verifyWebhook(req: HttpRequest): VerifiedRequest | null
  parseInboundMessage(v): InboundMessage // SMS or WhatsApp
  parseMessageStatus(v): MessageStatusEvent
  parseInboundCall(v, route: CallChannel): InboundCall
  parseCallStatus(v): CallStatusEvent
  parseDialResult(v): DialResultEvent
  parseRecordingReady(v): RecordingReadyEvent
  parseDigits(v): { callId: string; digits: string }

  // ---- call markup
  render(instructions: CallInstruction[]): { contentType: string; body: string }

  // ---- outbound REST (must be idempotent from the caller's side, see §6)
  sendMessage(m: SendMessageInput): Promise<Accepted | Rejected | Uncertain>
  placeCall(c: PlaceCallInput): Promise<Accepted | Rejected | Uncertain>
  hangupCall(providerCallId: string): Promise<void>
  redirectCall(providerCallId: string, url: string): Promise<void>
  fetchRecording(rec: RecordingRef): Promise<ByteStream>
  deleteRecording(rec: RecordingRef): Promise<void>

  // ---- browser calling
  issueBrowserToken(
    staffIdentity: string,
    ttlSec: number
  ): Promise<BrowserCredential>

  // ---- AI audio WebSocket
  streamCodec: StreamCodec
}

type Accepted = { kind: "accepted"; providerId: string } // Plivo call: request UUID
type Rejected = { kind: "rejected"; code: string; retryable: false }
type Uncertain = { kind: "uncertain"; reason: string } // timeout / 5xx: may have been sent

interface InboundMessage {
  providerMessageId: string
  channel: Channel
  from: E164
  to: E164
  body: string
  media: { url: string; contentType: string }[] // provider URLs; copy, then forget
  waButtonPayload?: string // quick reply / permission reply
  receivedAt: Date
}

interface MessageStatusEvent {
  providerMessageId: string
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "undelivered"
  errorCode?: string
}

interface InboundCall {
  providerCallId: string
  channel: CallChannel
  from: E164
  to: E164
  callerName?: string
}

interface CallStatusEvent {
  providerCallId: string
  providerRequestId?: string // Plivo outbound correlation
  status:
    | "ringing"
    | "in_progress"
    | "completed"
    | "busy"
    | "no_answer"
    | "failed"
    | "canceled"
  durationSec?: number
  billedSec?: number
  hangupCause?: string
}
```

### Number normalization (shared helper)

```ts
function normalizeE164(raw: string): E164 | null {
  let s = raw.trim()
  s = s.replace(/^whatsapp:/i, "") // Twilio WhatsApp addressing
  s = s.replace(/^sip:|^client:/i, "") // never a customer number; caller decides
  s = s.replace(/[\s()-]/g, "")
  if (/^0[2-578]\d{8}$/.test(s)) s = "+61" + s.slice(1) // AU national format
  if (/^61\d{9}$/.test(s)) s = "+" + s // Plivo-style no plus
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null
  return s
}
```

Treat `client:…`, `sip:…` and Plivo endpoint usernames as **staff identities**, never as
customer phone numbers.

## 5. Call instruction DSL

Business logic describes a call step as neutral instructions. Each adapter renders them to
TwiML or Plivo XML. This keeps IVR, routing and AI hand-off logic identical across
providers.

```ts
type CallInstruction =
  | { op: "say"; text: string; voice?: "female" | "male"; language?: "en-AU" }
  | { op: "play"; url: string }
  | { op: "pause"; seconds: number }
  | {
      op: "gatherDigits"
      numDigits: number
      timeoutSec: number
      actionUrl: string
      prompt: CallInstruction[]
    } // prompt = say/play only
  | {
      op: "dialNumber"
      to: E164
      callerId: E164
      timeoutSec: number
      actionUrl: string
      record?: "off" | "from_answer_dual"
      recordingCallbackUrl?: string
    }
  | {
      op: "dialBrowser"
      staffIdentity: string
      callerId?: E164
      timeoutSec: number
      actionUrl: string
      record?: "off" | "from_answer_dual"
      recordingCallbackUrl?: string
    }
  | { op: "dialWhatsApp"; to: E164; callerId: E164; actionUrl: string } // business-initiated WA leg
  | {
      op: "streamToAgent"
      wsUrl: string
      sessionToken: string
      statusUrl: string
    }
  | { op: "recordSession"; callbackUrl: string } // whole-call background recording
  | { op: "redirect"; url: string }
  | { op: "hangup" }
```

All URLs passed to the DSL are absolute: `COMMS_WEBHOOK_ORIGIN + "/webhooks/<provider>/…"`.
Each adapter's route table is listed in its file.

## 6. Webhook pipeline (every inbound HTTP callback)

```ts
async function handleWebhook(
  provider: CommsProvider,
  kind: WebhookKind,
  req: HttpRequest
) {
  // 1. Verify before reading anything else. Unsigned -> 403, no DB access.
  const v = provider.verifyWebhook(req)
  if (!v) return http(403)

  // 2. Normalize into a neutral event (adapter), then derive a dedupe key.
  const event = parseByKind(provider, kind, v)
  const dedupeKey = dedupeKeyFor(kind, event)
  //    message:      "msg:" + providerMessageId
  //    status:       "st:"  + providerMessageId + ":" + status
  //    call status:  "cs:"  + providerCallId + ":" + status
  //    recording:    "rec:" + providerRecordingId

  // 3. Record the delivery once. A duplicate returns the same response without side effects.
  const fresh = await db.tx((tx) =>
    tx.webhookDelivery.insertIfAbsent({
      provider: provider.name,
      kind,
      dedupeKey,
      payload: redact(v.params),
      receivedAt: clock.now(),
    })
  )

  // 4a. Call-control webhooks must answer synchronously with markup (keep < 2 s).
  if (isCallControl(kind)) {
    const steps = await callRouter.decide(event, { duplicate: !fresh }) // pure, fast, no external calls
    const out = provider.render(steps)
    return http(200, out.body, { "content-type": out.contentType })
  }

  // 4b. Everything else: enqueue and return 200/204 quickly.
  if (fresh)
    await queue.enqueue({
      kind: "process_webhook",
      deliveryKey: dedupeKey,
      provider: provider.name,
    })
  return http(204)
}
```

Rules:

- **Signature URL = public URL.** Behind a proxy, rebuild it from `COMMS_WEBHOOK_ORIGIN` plus
  the request path and the exact query string. Do not use the internal host.
- **Read the raw body once**, cap its size (64 KB is plenty) and decode it yourself, so the
  signed bytes equal the parsed fields.
- **Rotate tokens safely.** Accept the current token and an optional previous token during
  rotation.
- **Redact before storing.** Remove message bodies and media URLs from logs. Keep them only in
  the `Message` table.
- **Status events arrive out of order.** Apply them with the monotonic rule in §8.

## 7. Outbound sends via outbox (messages and calls)

Never call the provider inside a user's HTTP request. Write the intent and an outbox job in
one transaction, then let a worker send it.

```ts
async function queueOutboundMessage(input) {
  return db.tx(async (tx) => {
    const conv = await tx.conversation.findOrCreate(
      input.contactId,
      input.channel
    )
    assertChannelPolicy(conv, input) // §9 WhatsApp window/template, Spam Act consent
    const msg = await tx.message.insert({
      conversationId: conv.id,
      direction: "out",
      channel: input.channel,
      body: input.body,
      templateRef: input.templateRef,
      status: "pending",
      provider: env("COMMS_PROVIDER"),
      idempotencyKey: input.idempotencyKey ?? uuid(),
    }) // UNIQUE(idempotencyKey) blocks double-click sends
    await tx.outboxJob.insert({
      kind: "send_message",
      payload: { messageId: msg.id },
      provider: msg.provider,
    })
    return msg
  })
}

async function runSendMessageJob(job) {
  const msg = await db.message.get(job.payload.messageId)
  if (msg.providerMessageId || msg.status !== "pending") return done(job) // already sent
  const provider = adapters[job.provider]
  const result = await provider.sendMessage(toSendInput(msg))
  switch (result.kind) {
    case "accepted":
      await db.message.update(msg.id, {
        providerMessageId: result.providerId,
        status: "queued",
      })
      return done(job)
    case "rejected":
      await db.message.update(msg.id, {
        status: "failed",
        errorCode: result.code,
      })
      return done(job)
    case "uncertain":
      await db.message.update(msg.id, { status: "uncertain" })
      return reconcileLater(job) // look up by time window/recipient before any retry
  }
}
```

**Never blindly retry an `uncertain` send.** It may already have reached the customer. Look
up recent messages or calls for that recipient on the provider, match them, then decide.
Twilio accepts no client idempotency key for Messages/Calls, and none was found for Plivo, so
reconciliation is the only safe path.

## 8. State machines

### Message status (monotonic)

```
pending ─► queued ─► sent ─► delivered ─► read
   │          │        │
   └──────────┴────────┴─► failed | undelivered      (terminal)
uncertain ─► (reconcile) ─► queued | failed
```

```ts
const RANK = {
  pending: 0,
  uncertain: 0,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 9,
  undelivered: 9,
}
function applyStatus(current, incoming) {
  if (RANK[current] === 9) return current // terminal wins
  return RANK[incoming] > RANK[current] ? incoming : current // ignore late "sent" after "delivered"
}
```

### Call status

```
created ─► ringing ─► in_progress ─► completed
   │          │
   └──────────┴─► busy | no_answer | failed | canceled           (terminal)
```

Record `answeredBy` separately from status: `ai` when the stream starts, `staff` when a dial
leg answers. A bridged call has a **parent (customer) leg** and **child (staff/agent) legs**.
Identity, CRM attribution and direction come from the parent leg only. A staff leg is
technically "outbound" even when the customer called in.

## 9. Channel policy (enforce before enqueueing)

```ts
function assertChannelPolicy(conv, input) {
  if (
    input.purpose === "marketing" &&
    !hasConsent(conv.contactId, input.channel, "marketing")
  )
    throw policyError("NO_MARKETING_CONSENT") // Spam Act
  if (isUnsubscribed(conv.contactId, input.channel))
    throw policyError("UNSUBSCRIBED")

  if (input.channel === "whatsapp") {
    const windowOpen =
      conv.lastInboundAt && clock.now() - conv.lastInboundAt < 24 * HOUR
    if (!windowOpen && !input.templateRef)
      throw policyError("WA_TEMPLATE_REQUIRED")
    if (
      input.templateRef &&
      template(input.templateRef).approvalStatus !== "approved"
    )
      throw policyError("WA_TEMPLATE_NOT_APPROVED")
  }
  if (input.channel === "sms" && segments(input.body) > 3)
    warn("SMS_LONG_COSTLY")
  if (
    isQuietHours(input.recipientTz ?? env("DEFAULT_TIMEZONE")) &&
    input.purpose === "marketing"
  )
    throw policyError("QUIET_HOURS")
}
```

- `lastInboundAt` updates **only** on a real customer message or customer-initiated call.
  Status callbacks and permission events do not reopen the WhatsApp window.
- SMS segment counting: GSM-7 is 160 chars per single segment, 153 per segment when
  concatenated. UCS-2 (any emoji or non-GSM character) is 70, or 67 when concatenated.
  Both providers bill per segment.
- Inbound `STOP`, `UNSUBSCRIBE`, `OPT OUT` (case-insensitive, trimmed) revoke marketing
  consent for that channel before any other processing.

## 10. Call router (neutral, pure)

The router returns DSL steps. It must be fast and side-effect free (writes go through the
ledger/outbox), because the provider is waiting for markup.

```ts
function decideInboundCall(call: InboundCall, ctx): CallInstruction[] {
  const base = env("COMMS_WEBHOOK_ORIGIN") + "/webhooks/" + ctx.provider

  if (call.channel === "whatsapp") {
    // WhatsApp calls cannot go to PSTN on either provider: browser/SIP only.
    const agent = pickAvailableStaff(ctx) // presence from your app
    if (!agent)
      return [
        say("Sorry, no one is available. We'll message you shortly."),
        hangup(),
      ]
    return [
      {
        op: "dialBrowser",
        staffIdentity: agent.identity,
        timeoutSec: 25,
        actionUrl: base + "/voice/dial-complete",
      },
    ]
  }

  if (env("AI_AGENT_ENABLED")) {
    const token = mintStreamSessionToken(call.providerCallId, 10 * MINUTE) // §11
    return [
      ...recordingNoticeIfEnabled(),
      {
        op: "streamToAgent",
        wsUrl: wsOrigin() + env("AI_AGENT_WS_PATH"),
        sessionToken: token,
        statusUrl: base + "/voice/stream-status",
      },
      // after the stream ends (agent requested hand-over), the provider continues here:
      { op: "redirect", url: base + "/voice/after-agent" },
    ]
  }

  if (env("RECORDING_MODE") === "consented") {
    return [
      {
        op: "gatherDigits",
        numDigits: 1,
        timeoutSec: 6,
        actionUrl: base + "/voice/consent",
        prompt: [
          say(
            "This call may be recorded for quality. Press 1 to allow recording, or 2 to continue without recording."
          ),
        ],
      },
      { op: "redirect", url: base + "/voice/consent?Digits=none" },
    ]
  }
  return dialStaff(call, base, /*record*/ "off")
}

function dialStaff(call, base, record): CallInstruction[] {
  const agent = pickAvailableStaff()
  if (agent?.inBrowser)
    return [
      {
        op: "dialBrowser",
        staffIdentity: agent.identity,
        callerId: call.from,
        timeoutSec: 25,
        actionUrl: base + "/voice/dial-complete",
        record,
        recordingCallbackUrl: base + "/voice/recording",
      },
    ]
  return [
    {
      op: "dialNumber",
      to: env("STAFF_FORWARD_E164"),
      callerId: call.from,
      timeoutSec: 25,
      actionUrl: base + "/voice/dial-complete",
      record,
      recordingCallbackUrl: base + "/voice/recording",
    },
  ]
}
// dial-complete: if not answered -> voicemail (say + record) or "we'll call back" + create a callback task.
```

**Caller ID when forwarding:** presenting the customer's number (`callerId: call.from`) to the
staff phone is useful but must be allowed by the provider and AU carrier rules for
verified/forwarded calls. If it is rejected, present the business number and show the
customer's number in your app.

## 11. AI voice agent over WebSocket (neutral)

Both providers send μ-law 8 kHz (or L16) base64 audio frames over a WebSocket and accept
audio frames back. The adapter's `StreamCodec` converts between wire JSON and these neutral
events:

```ts
type StreamIn =
  | {
      type: "start"
      providerCallId: string
      streamId: string
      sessionToken?: string
      encoding: "mulaw" | "l16"
      sampleRate: 8000 | 16000
    }
  | { type: "audio"; payload: Bytes; timestampMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "mark_done"; name: string } // playback reached a checkpoint
  | { type: "stop" }

type StreamOut =
  | { type: "audio"; payload: Bytes } // same codec/rate as start
  | { type: "mark"; name: string } // ask provider to tell us when playback reaches here
  | { type: "clear" } // barge-in: drop queued audio

interface StreamCodec {
  decode(frame: string): StreamIn | null
  encode(
    msg: StreamOut,
    ctx: { streamId: string; encoding; sampleRate }
  ): string
  sessionTokenFrom(start: any, handshake: HttpRequest): string | null
}
```

```ts
ws.server(env("AI_AGENT_WS_PATH"), async (socket, handshake) => {
  const provider = adapterFromHandshake(handshake) // separate paths per provider are simplest
  let session = null

  socket.onMessage(async (frame) => {
    const ev = provider.streamCodec.decode(frame)
    if (!ev) return
    if (!session && ev.type !== "start") return socket.close() // nothing before a valid start
    switch (ev.type) {
      case "start": {
        const token = provider.streamCodec.sessionTokenFrom(ev, handshake)
        const claim = verifyStreamSessionToken(token, ev.providerCallId) // HMAC, expiry, single use
        if (!claim) return socket.close()
        session = await aiAgent.open({
          callId: claim.callId,
          encoding: ev.encoding,
          sampleRate: ev.sampleRate,
          onAudio: (bytes) =>
            socket.send(
              provider.streamCodec.encode(
                { type: "audio", payload: bytes },
                ctxOf(ev)
              )
            ),
          onInterrupt: () =>
            socket.send(
              provider.streamCodec.encode({ type: "clear" }, ctxOf(ev))
            ),
          onHandover: (reason) => requestHandover(claim.callId, reason), // §11.1
        })
        break
      }
      case "audio":
        session.pushCallerAudio(ev.payload)
        break
      case "dtmf":
        session.pushDigit(ev.digit)
        break
      case "mark_done":
        session.playbackReached(ev.name)
        break
      case "stop":
        await session.close()
        break
    }
  })
  socket.onClose(() => session?.close())
})
```

### 11.1 Hand-over from AI to a human

Two portable methods. Choose one per provider.

1. **End the stream, then continue the call markup.** The DSL places
   `redirect → /voice/after-agent` after `streamToAgent`. When the AI wants a human, close the
   WebSocket (Twilio `<Connect><Stream>`) or end the stream (Plivo with `keepCallAlive="true"`).
   The provider then continues with the next instruction, and `/voice/after-agent` returns
   `dialStaff(...)` steps.
2. **Redirect the live call via REST.** `adapter.redirectCall(providerCallId, base + "/voice/after-agent")`.
   This works whichever element is executing.

Store the reason and a short AI summary on the `Call` **before** the hand-over, so the staff
screen can show it when the leg rings.

### 11.2 Stream session token

```ts
function mintStreamSessionToken(providerCallId, ttlMs) {
  const body = base64url(
    json.stringify({ c: providerCallId, e: clock.now() + ttlMs, n: uuid() })
  )
  return body + "." + base64url(hmacSha256(env("STREAM_TOKEN_SECRET"), body))
}
function verifyStreamSessionToken(token, providerCallId) {
  const [body, sig] = (token ?? "").split(".")
  if (
    !body ||
    !timingSafeEqual(
      sig,
      base64url(hmacSha256(env("STREAM_TOKEN_SECRET"), body))
    )
  )
    return null
  const c = json.parse(fromBase64url(body))
  if (c.c !== providerCallId || c.e < clock.now() || !consumeNonceOnce(c.n))
    return null
  return { callId: c.c }
}
```

Plivo `extraHeaders` allow only `A-Z a-z 0-9` (max 512 bytes). For Plivo, use **hex** encoding
for the token parts and join them with a letter (for example `x`) instead of `.`.

## 12. Browser calling (staff softphone, neutral flow)

```
staff opens app ─► GET /api/voice/token ─► adapter.issueBrowserToken(identity) ─► SDK registers
inbound:  router returns dialBrowser(identity) ─► SDK rings ─► staff accepts
outbound: staff clicks Call ─► POST /api/calls (writes Call + outbox) ─► adapter.placeCall
          (customer-first: call customer, on answer dial the staff browser)  OR
          SDK-originated (browser dials; provider asks your app for markup ─► dialNumber(customer))
```

Prefer **SDK-originated** for simple softphones: one leg, one webhook, and the staff member
hears ringing. Prefer **customer-first REST** when calls must be placed by a server job
(callback queues, AI-initiated callbacks).

Security: the token endpoint requires an authenticated staff session, issues short tokens
(≤ 1 hour), and the outbound markup endpoint re-checks that the `To` number is allowed:
AU numbers only, not premium (`19xx`), not emergency (`000`, `112`), and not on your blocklist.

## 13. Recording pipeline (neutral)

```
recording-ready webhook ─► ledger ─► job fetch_recording
  ─► adapter.fetchRecording (authenticated) ─► blob.putPrivate ─► checksum
  ─► Recording.status = "stored" ─► (optional) transcription job
  ─► adapter.deleteRecording (provider copy) after a verified private copy
```

Never fetch a URL taken straight from a callback without checking that its host belongs to
the provider (SSRF). Prefer building the fetch URL from the recording ID.

## 14. WhatsApp calling permission (neutral)

Business-initiated WhatsApp calls need the user's permission. Limits on the research date
(Meta policy, enforced by both providers): permission requests are limited to **1 per 24 h
and 2 per 7 days**; after a grant, up to **5 connected calls per 24 h**; a grant lasts **7 days**
unless permanent; **2 consecutive missed calls** trigger a warning; **4** revoke the grant.
`VERIFY` current limits before launch.

```ts
async function startWhatsAppCall(staff, contact) {
  const perm = await db.waCallPermission.get(
    contact.id,
    env("BUSINESS_NUMBER_E164")
  )
  if (perm.state !== "granted" || perm.expiresAt < clock.now()) {
    if (!canRequestPermission(perm))
      throw policyError("WA_PERMISSION_RATE_LIMIT")
    await queueOutboundMessage({
      contactId: contact.id,
      channel: "whatsapp",
      templateRef: "call_permission_request",
      purpose: "utility",
    }) // provider-specific content, see adapters
    await db.waCallPermission.markRequested(perm.id, clock.now())
    return { status: "permission_requested" }
  }
  if (perm.callsInWindow.filter((t) => clock.now() - t < 24 * HOUR).length >= 5)
    throw policyError("WA_CALL_QUOTA")
  return queueOutboundCall({
    channel: "whatsapp",
    to: contact.whatsappE164,
    staffIdentity: staff.identity,
  })
}
// Permission replies arrive on the messaging webhook as a button/interactive reply.
// Route them to applyPermissionReply() BEFORE ordinary inbox processing. Never treat free text "yes" as a grant.
```

## 15. Observability

Log one structured line per event: `provider`, `kind`, `providerId`, `internalId`, `status`,
`latencyMs`. Never log tokens, message bodies or full phone numbers (mask to `+61412***678`).
Alert on:

- signature failures above the baseline (wrong URL or token rotation),
- outbox jobs stuck `uncertain` for more than 10 minutes,
- call-control webhook p95 above 1.5 s,
- WebSocket sessions with no audio for 10 s,
- a daily spend jump above the configured threshold (poll provider usage APIs).
