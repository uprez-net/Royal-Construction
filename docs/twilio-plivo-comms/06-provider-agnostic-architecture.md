# 6. Provider-agnostic communications architecture (Twilio, Plivo, Telnyx)

> **Status: implemented in this repository for Twilio and Telnyx; Plivo is not built.**
> The neutral layer lives in `lib/comms/` — `factory.ts` (provider selection),
> `config.ts`, `callbacks.ts`, `webhook-handler.ts`, and the adapters in
> `providers/twilio/` and `providers/telnyx/`. Every carrier callback arrives at one route,
> `app/api/comms/[provider]/[event]/route.ts`; business rules live in `lib/domain/comms/`;
> the browser dialer is `components/comms/phone-provider.tsx` over
> `components/comms/dialer/{twilio,telnyx}-dialer.ts`. Operating it is in the
> [runbook](../comms-runbook.md).
>
> This file was first written as a migration guide for a different codebase
> (CitizenTechies). §1 below still describes **that** codebase as inspected on
> 3 November 2026 — its paths (`lib/integrations/twilio/*`, `PhoneDock.tsx`, …) do not
> exist here. §2 onwards is the design this repository follows; where it says "target",
> compare against the files above.

Read file 01 first. File 01 is the generic, project-agnostic contract. This file maps it
onto this repository, adds Telnyx, and defines the pieces file 01 leaves open: the factory,
capabilities, normalised events, per-tenant selection and the browser dialer.

## 1. The original Twilio-only codebase (CitizenTechies, not this repository)

Kept as a worked example of finding provider coupling. In that codebase only **Twilio**
was implemented; none of the paths in this section exist in this repository.

| Area                 | Where it lives today                                                                                                                                  | Provider coupling                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Config               | `lib/integrations/twilio/config.ts` (`TWILIO_*`, `PHONE_CALLS_ENABLED`, `TWILIO_SMS_ENABLED`, `TWILIO_WEBHOOK_ORIGIN`)                                | Env names and `AC…` account-SID check are Twilio-specific.                                         |
| REST client          | `lib/integrations/twilio/client.ts`                                                                                                                   | Twilio SDK, retries off, `definiteRejection`/`providerCode` classify 4xx vs uncertain.             |
| Outbound SMS         | `lib/integrations/twilio/sms-send.ts`, called from `lib/integrations/chat-reply.ts`                                                                   | `SmsRejected` is a Twilio-named error caught by the shared reply code.                             |
| Inbound SMS          | `app/api/twilio/sms/inbound/route.ts`, `lib/integrations/twilio/sms.ts` (`smsIncoming`)                                                               | Reads Twilio form fields (`MessageSid`, `NumMedia`); validates `SM`/`MM` SIDs.                     |
| Webhook verification | `lib/integrations/twilio/webhook.ts`, `routes.ts` (`twilioRoute`)                                                                                     | `X-Twilio-Signature`, SMS may use a different Auth Token and region than voice.                    |
| Outbound call        | `lib/integrations/twilio/voice-worker.ts` (`runCallOriginate`, `endProviderCall`, `reconcileStaleCalls`)                                              | `calls.create/update/fetch`, answer URL returns TwiML.                                             |
| Call flow markup     | `lib/integrations/twilio/twiml.ts`, `call-agent.ts`, 11 routes under `app/api/twilio/voice/*`                                                         | TwiML, `<Dial><Client>`, `<Gather>`, `<Connect><Stream>`, per-leg status callbacks.                |
| AI front office      | `live-session.ts`, `app/api/twilio/voice/live`, `lib/domain/call-agent*.ts`                                                                           | Twilio Media Streams WebSocket and its signed upgrade.                                             |
| Recordings           | `lib/integrations/twilio/recording-worker.ts`, `app/api/twilio/voice/recordings`, `lib/domain/call-recordings.ts`                                     | Twilio recording URLs, media-host allow-list, Twilio-side deletion.                                |
| Browser softphone    | `app/api/admin/voice/token/route.ts` (imports `twilio` and builds the JWT in the route), `components/admin/phone/PhoneDock.tsx` (`@twilio/voice-sdk`) | Token minting and the SDK `Device` are Twilio-only. The route itself imports the provider.         |
| Call UI              | `components/admin/calls/CallModal.tsx`, `CallButton.tsx`, `call-labels.ts`                                                                            | Mostly neutral (labels over CRM statuses); driven by `PhoneDock` state.                            |
| WhatsApp calling ICE | `lib/integrations/whatsapp-call-ice.ts`                                                                                                               | Uses Twilio's `tokens.create` for TURN servers. Separate from PSTN, but still a Twilio dependency. |
| Domain               | `lib/domain/calls.ts`, `prisma/schema.prisma` (`Call.callSid`, `CallLeg.callSid`, `CallRecording.recordingSid`, `BusinessPhone.kind = "twilio"`)      | See §1.1.                                                                                          |
| Cron                 | `app/api/cron/crm/route.ts` calls `reconcileStaleCalls`                                                                                               | Goes straight to Twilio.                                                                           |
| Tests                | `tests/twilio-sms.test.ts`, `twilio-voice.test.ts`, `call-agent.test.ts`, `live-*.test.ts`                                                            | Twilio-shaped fixtures.                                                                            |
| Architecture guard   | `tests/architecture.test.ts`                                                                                                                          | Domain code may import only `node:`, `@/lib/domain/*` and generated Prisma. Keep it that way.      |

### 1.1 Provider leakage into shared logic

These are the places a provider switch would break. Fix them before adding another adapter.

1. **`lib/domain/calls.ts` validates call IDs with a Twilio regex** (`/^CA[0-9a-f]{32}$/`
   in `isCallSid`). Every Plivo UUID and Telnyx `call_control_id` would be rejected, so
   `applyCallStatus`, `settleCallOriginate` and friends would silently ignore them.
   Replace it with an opaque-ID check (length and character set only). This is the single
   most important prerequisite.
2. **The domain status vocabulary mirrors Twilio** (`in-progress`, `no-answer`,
   `canceled`). Keep these as the _internal_ vocabulary (they are already persisted), and
   make every adapter map into them. Do not invent a second vocabulary.
3. **Column names say `callSid`/`recordingSid`.** Treat them as "provider call ID" and
   "provider recording ID". A rename is cosmetic and needs a migration; it is not required
   to switch providers. Do not store a provider's ID shape in business logic.
4. **No `provider` column on `Call`, `CallLeg`, `CallRecording`.** A call's owner can be
   inferred from the ID shape (Twilio `CA…`, Plivo UUID, Telnyx `v3:…`), which is enough
   for in-flight calls and reconciliation. For durable history and per-tenant routing, add
   a nullable `provider` column in a **one-off** migration (see §7). After that, switching
   the _active_ provider never needs another migration.
5. **`BusinessPhone.kind` is `"twilio" | "whatsapp"`.** `"twilio"` actually means "PSTN
   number". Treat it as a channel kind, and add `provider` beside it (§7) rather than
   widening `kind` per vendor.
6. **`app/api/admin/voice/token/route.ts` builds a Twilio JWT inline.** Move minting
   behind `BrowserCalling.issueCredential`.
7. **`chat-reply.ts` imports `SmsRejected` from the Twilio module.** Replace with the
   neutral `CommsError` (§3).
8. **Webhook origin and enable flags are Twilio-named** (`TWILIO_WEBHOOK_ORIGIN`,
   `TWILIO_SMS_ENABLED`). Keep them as aliases; add neutral names (§5).
9. **`PhoneDock.tsx` constructs a Twilio `Device`.** Hide it behind the dialer interface
   (§8).
10. **Inbound call flow, AI stream and recording** are written in TwiML and Twilio Media
    Streams (§9). These are _not_ portable by configuration alone. They are the main
    provider-specific operational work.

### 1.2 Feature support and gaps

| Feature                                    | Twilio (code)                                            | Plivo                      | Telnyx                                     |
| ------------------------------------------ | -------------------------------------------------------- | -------------------------- | ------------------------------------------ |
| Outbound SMS and delivery status           | Yes                                                      | Documented, no code        | New                                        |
| Inbound SMS intake                         | Yes                                                      | Documented, no code        | New                                        |
| Outbound call to lead, bridged to browser  | Yes                                                      | Documented, no code        | New (command model)                        |
| End / reconcile a call                     | Yes                                                      | Documented                 | New                                        |
| Browser softphone                          | Yes (bundled)                                            | SDK not bundled            | SDK not bundled                            |
| Inbound call flow (consent, forward, ring) | Yes                                                      | Documented as XML, no code | New (command model)                        |
| AI front office audio stream               | Yes (Media Streams)                                      | Documented codec, no code  | Streaming command exists; codec unverified |
| Recording download and delete              | Yes                                                      | Documented                 | New                                        |
| WhatsApp messaging and calling             | Meta Cloud API directly (not via the SMS/voice provider) | Via Plivo (documented)     | Not researched                             |

WhatsApp in this repository is integrated against Meta directly (`app/api/whatsApp/*`,
`lib/domain/whatsapp*.ts`, `services/whatsapp-media`). It does not depend on the PSTN
provider, so this architecture leaves it alone. Only the Twilio TURN call in
`whatsapp-call-ice.ts` needs a neutral replacement or a dedicated TURN setting.

## 2. Target architecture

```text
 CRM UI / business workflows (domain, workflows, route handlers)
                      |
                      v
        Communications service layer
        (queue SMS, request call, end call, issue browser credential,
         apply normalised events to the CRM database)
                      |
                      v
        Provider-agnostic interfaces  (CommunicationsProvider)
        messaging | voice | callControl | browser | webhooks | capabilities
                      |
                      v
        Provider factory  (default from env, optional per-tenant resolver,
                           webhooks routed by URL path)
                      |
          +-----------+-----------+
          |           |           |
       Twilio       Plivo       Telnyx        <- the only code that imports an SDK,
          |           |           |              signs requests or knows a wire format
          +-----------+-----------+
                      |
                      v
        Normalised events  (sms.received, sms.status, call.status)
                      |
                      v
        CRM database / event processing  (idempotent, monotonic)
```

Proposed layout (new files; existing Twilio files are moved into the adapter, not rewritten):

```text
lib/integrations/comms/
  types.ts            contracts, capabilities, CommsError, normalised events
  factory.ts          the only provider selection code
  config.ts           neutral env readers, callback URL builder
  events.ts           dedupe keys, state ordering, payload redaction
  service.ts          the functions the rest of the app calls
  providers/
    twilio.ts         wraps existing lib/integrations/twilio/*
    plivo.ts          REST + XML, no SDK
    telnyx.ts         REST + Ed25519 webhooks, no SDK
app/api/comms/[provider]/{sms-inbound,sms-status,status,connect}/route.ts
hooks/use-communications-dialer.ts
```

Rules that keep the boundary real:

- Provider SDK imports (`twilio`, `@twilio/voice-sdk`, any Plivo/Telnyx package) appear
  only in `providers/*` and in the browser adapter files (§8).
- `lib/domain/*` imports no provider code (already enforced by `tests/architecture.test.ts`).
  Add a second test that fails if anything outside `providers/` or `lib/integrations/twilio/`
  imports `twilio`, and that bans the string `provider === "` outside `factory.ts`.
- The only `switch (provider)` in the codebase is the builder table in `factory.ts`.
- Callers ask for behaviour (`sendSms`), never for a vendor. Callers that need an optional
  feature check `provider.capabilities`, not the provider's name.

## 3. Interfaces

These are adapted to what the CRM actually does (queue an SMS, place a customer leg,
cancel or complete it, ask its state, hand the answered leg to a browser, mint a browser
token, verify and parse callbacks). Names are final enough to code against; adjust field
types to the codebase as you go.

```ts
export type CommsProviderName = "twilio" | "plivo" | "telnyx"

export type CommsCapabilities = {
  sms: boolean
  outboundCalls: boolean
  hangup: boolean
  callStatusLookup: boolean
  browserCalling: boolean // backend can issue a credential
  browserSdkBundled: boolean // the app ships a client SDK for it
  callControl: "markup" | "commands" // see §3.1
  inboundCallFlow: boolean // consent gate, forwarding, ring-the-CRM implemented
  recordings: boolean
}

export interface MessagingProvider {
  sendSms(i: {
    from: string
    to: string
    body: string
  }): Promise<{ providerMessageId: string }>
}

export interface VoiceProvider {
  placeCall(i: PlaceCallInput): Promise<{ providerCallId: string }>
  endCall(providerCallId: string, phase: "ringing" | "answered"): Promise<void>
  getCallStatus(
    providerCallId: string
  ): Promise<{ state: CallState; durationSeconds: number | null }>
}

export interface CallControl {
  render(steps: CallInstruction[]): { contentType: string; body: string } // markup providers
  execute(providerCallId: string, steps: CallInstruction[]): Promise<void> // command providers
}

export interface BrowserCalling {
  issueCredential(
    identity: string,
    ttlSeconds: number
  ): Promise<BrowserCredential>
}

export interface WebhookHandler {
  verify(req: { url: string; headers: Headers; rawBody: string }): boolean
  parse(
    kind: "sms.inbound" | "sms.status" | "voice",
    req: RawWebhook
  ): CommsEvent[]
}

export interface CommunicationsProvider {
  readonly name: CommsProviderName
  readonly capabilities: CommsCapabilities
  readonly messaging: MessagingProvider
  readonly voice: VoiceProvider
  readonly callControl: CallControl
  readonly browser: BrowserCalling
  readonly webhooks: WebhookHandler
}
```

`CallState` is the existing persisted vocabulary: `queued | initiated | ringing |
in-progress | completed | busy | no-answer | failed | canceled`.

### 3.1 Why call control has two models

Do not pretend the vendors steer a call the same way.

- **Markup (Twilio, Plivo):** the provider requests a URL when something happens and the
  response body (TwiML or Plivo XML) says what to do next. `render(steps)` serves that
  response. The existing `twiml.ts` is the Twilio renderer.
- **Commands (Telnyx Call Control):** the provider posts a JSON event to your webhook and
  you answer `200`. To act, you separately call REST commands on the call (`answer`,
  `transfer`, `bridge`, `hangup`, play audio, speak, record, stream). `execute(callId, steps)`
  issues those commands. Telnyx also has its own TeXML markup mode; this guide uses the
  command model because it is what the Call Control API documents.

The call-instruction DSL from file 01 §5 is the shared language. A route builds neutral
steps; a markup adapter renders them, a command adapter executes them. Unsupported steps
throw `CommsError("unsupported")` (for example `pause` on Telnyx, which has no pause
command, or `execute` on Plivo, which controls live calls only through XML and a small
set of REST calls).

### 3.2 Errors

One error type crosses the boundary. It replaces `SmsRejected` and the Twilio-specific
`definiteRejection`/`providerCode` helpers.

```ts
type CommsErrorKind =
  | "rejected" // provider refused; nothing was sent or changed
  | "uncertain" // timeout / 5xx / 429: may have been sent; reconcile, never blind-retry
  | "unsupported" // capability missing
  | "config" // credentials or settings missing/invalid

class CommsError extends Error {
  kind: CommsErrorKind
  providerCode: string // TWILIO_21211, PLIVO_400, TELNYX_40300 ...
}
```

This keeps the existing rule: a 4xx is a definite failure (`failed`); anything else is
`uncertain` and a person or the reconciler checks it. `chat-reply.ts` maps
`kind === "rejected"` to the same outcome it gives `SmsRejected` today.

## 4. Provider factory

`factory.ts` is the only place a provider is chosen.

```ts
defaultProviderName() // COMMUNICATIONS_PROVIDER, legacy alias COMMS_PROVIDER, else "twilio"
resolveProviderName({ tenantId }) // per-tenant resolver first, then the default
getProvider(name) // cached adapter instance
activeProvider({ tenantId }) // for NEW outbound work
providerFromPath(segment) // for inbound webhooks: /api/comms/<provider>/...
providerNameOfCallId(id) // for EXISTING calls: owner by ID shape (until a column exists)
providerForCall(id, ctx) // owner if known, else active
```

Behaviour that matters:

- **Unset means Twilio**, so existing deployments do not change.
- An **unknown value fails loudly** (`config` error naming the allowed values), never
  falls back silently.
- Adapters are built lazily. A deployment that never uses Plivo never needs Plivo
  credentials; missing credentials surface as `config` errors only when that adapter is
  used.
- **New outbound work** uses `activeProvider`. **Existing work** (ending a call,
  reconciling it, fetching a recording, handling a callback) uses the provider that owns
  it. This is what makes a mid-day configuration change safe for in-progress calls.

## 5. Configuration

```env
# Which provider handles NEW outbound SMS and calls. Default: twilio.
COMMUNICATIONS_PROVIDER=telnyx

# Public HTTPS origin providers call. Falls back to TWILIO_WEBHOOK_ORIGIN, then BETTER_AUTH_URL.
COMMS_WEBHOOK_ORIGIN=

# Twilio (existing names, unchanged)
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_AUTH_TOKEN=
TWILIO_PREVIOUS_AUTH_TOKEN=

# Plivo
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PREVIOUS_AUTH_TOKEN=      # optional, token rotation overlap

# Telnyx
TELNYX_API_KEY=
TELNYX_PUBLIC_KEY=              # base64 Ed25519 key from Mission Control, for webhooks
TELNYX_CONNECTION_ID=           # Call Control Application ID used for outbound calls
TELNYX_WEBRTC_CONNECTION_ID=    # credential connection used for browser logins
TELNYX_MESSAGING_PROFILE_ID=
```

These names are the proposal; Twilio's are the real existing ones. Existing flags
(`PHONE_CALLS_ENABLED`, `TWILIO_SMS_ENABLED`, `PHONE_AGENT_ENABLED`) gate features, not
vendors. When coding, rename the readers behind them to ask the provider ("configured?")
rather than testing `AC…` SIDs. Keep the old names working as aliases.

To switch the active provider: set `COMMUNICATIONS_PROVIDER`, add that provider's
credentials, configure its numbers and webhook URLs (file 02/03/07), and redeploy. No
database migration, and no change to CRM components or domain code, once the one-off
prerequisites in §1.1 and §7 are done.

**What does not move on its own.** Phone numbers stay with the provider that owns them
(porting is a separate carrier process), active calls finish on the provider that started
them, recordings stay where they were made until copied, Twilio ConversationRelay/Media
Streams behaviour does not exist elsewhere, and a provider's compliance approvals (AU
regulatory bundles, sender IDs) do not transfer. Treat each as operational setup.

### 5.1 Callback URLs

`commsCallback(provider, kind, params)` is the only function that builds a callback URL.
Twilio keeps its existing routes during the transition; others use generic routes.

| Kind          | Twilio (existing)                    | Plivo / Telnyx                      |
| ------------- | ------------------------------------ | ----------------------------------- |
| `connect`     | `/api/twilio/voice/customer-connect` | `/api/comms/<provider>/connect`     |
| `status`      | `/api/twilio/voice/status`           | `/api/comms/<provider>/status`      |
| `sms-inbound` | `/api/twilio/sms/inbound`            | `/api/comms/<provider>/sms-inbound` |
| `sms-status`  | (not used today)                     | `/api/comms/<provider>/sms-status`  |

A signature covers the exact URL, so each URL is built from the configured origin, never
from request headers. Callback URLs carry the **internal** call ID (`?callId=`), exactly
as `voiceCallback` does today, so a callback can be bound to a CRM row regardless of the
provider's own IDs.

## 6. Webhook normalisation and processing

Every callback goes through the same pipeline, in this order:

1. **Route to the provider** by the URL path segment (`providerFromPath`). Unknown → `404`.
   A provider that is configured but not active still handles its own callbacks.
2. **Read the raw body once** with a size cap (64 KB, as `readLimited` does today).
3. **`webhooks.verify`**. Failure → `403` with no database access and no body parsing
   beyond what verification needs.
4. **`webhooks.parse`** → `CommsEvent[]`. Unknown events return `[]` and a `2xx`.
5. **Idempotency.** Compute `eventDedupeKey(event)` and skip events already seen.
6. **Apply** to the CRM (intake for `sms.received`, `applyCallStatus` for `call.status`).
7. **Respond quickly.** Markup callbacks answer with rendered markup; event callbacks
   answer `2xx`/`204`. Heavy work goes to the existing workflows/effects.

### 6.1 Normalised events

```ts
type CommsEvent =
  | {
      type: "sms.received"
      provider
      messageId
      from
      to
      body
      mediaCount
      timestamp
    }
  | {
      type: "sms.status"
      provider
      messageId
      status: "queued" | "sent" | "delivered" | "failed"
      errorCode?
      timestamp
    }
  | {
      type: "call.status"
      provider
      callId
      parentCallId?
      state: CallState
      durationSeconds: number | null
      hangupCause?
      timestamp
      eventId
    }
```

`messageId` and `callId` are the **provider's** IDs and are stored as such (`callSid`
column, intake `providerId`). CRM IDs (`Call.id`, `Lead.id`) are separate and are the
only IDs the UI and workflows use. Numbers are normalised to `+<digits>` (Plivo omits the
`+`, Twilio may prefix `whatsapp:`).

### 6.2 Verification and mapping, per provider

| Concern           | Twilio                                                        | Plivo                                                                                                                                                                       | Telnyx                                                                                                |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Body format       | form-encoded                                                  | form-encoded (POST) or query (GET)                                                                                                                                          | JSON, `data.event_type` + `data.payload`                                                              |
| Signature         | `X-Twilio-Signature` = HMAC-SHA1(url + sorted params), base64 | `X-Plivo-Signature-V3` (+ `-Ma-V3`), nonce in `X-Plivo-Signature-V3-Nonce`: HMAC-SHA256(url + sorted POST params + `.` + nonce), base64; header may list several signatures | `telnyx-signature-ed25519` over `"<telnyx-timestamp>\|<raw body>"`, Ed25519, public key base64        |
| Replay protection | none beyond HTTPS/dedupe                                      | nonce; dedupe on event key                                                                                                                                                  | reject if `telnyx-timestamp` is older than 5 minutes                                                  |
| Key rotation      | `TWILIO_PREVIOUS_AUTH_TOKEN`                                  | accept current and previous token                                                                                                                                           | replace the public key; keep old until deliveries drain                                               |
| Raw body required | no (params)                                                   | no (params)                                                                                                                                                                 | **yes**: verify the exact bytes, never a re-serialised object                                         |
| Inbound SMS id    | `MessageSid`                                                  | `MessageUUID`                                                                                                                                                               | `data.payload.id`                                                                                     |
| Call id           | `CallSid`, parent `ParentCallSid`                             | `RequestUUID` for API-placed calls, else `CallUUID` (**VERIFY** which IDs each callback carries)                                                                            | `data.payload.call_control_id`                                                                        |
| Call states       | `CallStatus` values match ours                                | `ringing`, `in-progress`, `completed`, `busy`, `failed`, `no-answer`, `timeout`→`no-answer`, `cancel`→`canceled`                                                            | `call.initiated`→`initiated`, `call.answered`→`in-progress`, `call.hangup`→ by `hangup_cause` (below) |
| Duration          | `CallDuration`                                                | `Duration`                                                                                                                                                                  | hangup `end_time − start_time` (approximation: includes ring time; use billing/CDR if exact)          |
| Event dedupe key  | `CallSid:CallStatus:SequenceNumber`                           | `callId:state`                                                                                                                                                              | the Telnyx event `data.id`                                                                            |

Telnyx hangup mapping (**VERIFY** the causes against real events): `normal_clearing` after
an answer → `completed`; `user_busy` → `busy`; `no_answer`/`timeout` → `no-answer`;
`originator_cancel` → `canceled`; `call_rejected` → `busy`; anything else → `failed`.

Plivo's V3 and Telnyx's signing schemes are documented in the sources listed in
[README](./README.md#sources-read-on-the-research-date) and
[file 07](./07-telnyx-setup-and-pseudocode.md). Do not ship either verifier without
capturing a real signed request from a test account as a fixture (§10).

### 6.3 Duplicates, retries and ordering

- **Duplicates and retries.** The same provider event always yields the same dedupe key.
  SMS intake is already idempotent on `providerId` (`receiveDelivery`); keep that, so a
  retried `sms.received` creates no second message. Call status is idempotent in the
  domain (`applyCallStatus` ignores a repeated terminal state).
- **Out of order.** Rank states `queued 0 < initiated 1 < ringing 2 < in-progress 3 <
terminal 4`. An event may only move a call forward; a terminal call never reopens and
  may only fill in a missing duration (the domain already enforces this; `mayAdvance` in
  `events.ts` lets the webhook layer skip pointless work). SMS status ranks `queued <
sent < delivered`, with `failed` terminal.
- **Not dependent on synchronous delivery.** Reconciliation does not need webhooks:
  `reconcileStaleCalls` (cron) asks the owning provider for the real state of any call
  still live after `LIVE_CALL_WINDOW_MS`. Telnyx's lookup only reports alive or not, so
  it can confirm "ended" but not the exact final state; mark such calls `completed` with
  no duration rather than invent one.
- **Raw payload debugging.** Store at most a redacted copy (`redactPayload`: keys kept,
  values of bodies, numbers, names, tokens and media removed) keyed by the dedupe key, with
  a short retention. Never log signatures, tokens or message text.

## 7. Database and multi-tenant considerations

Today the app is effectively single-tenant: one set of provider credentials and one set of
`BusinessPhone` rows. Design so tenancy can be added without touching business logic.

**Minimum change (recommended, one migration, nullable and backward compatible):**

- `Call.provider`, `CallLeg.provider`, `CallRecording.provider`, `BusinessPhone.provider`:
  `String?`, `NULL` read as `"twilio"`. Backfill is optional.
- Unique constraints stay on the provider ID columns. Provider IDs from different vendors
  cannot realistically collide (SID vs UUID vs `v3:` token), but if you want a hard
  guarantee change to `@@unique([provider, callSid])` in the same migration.
- Switching the **active** provider afterwards is configuration only.

**Per-tenant selection (when there is more than one business):**

- Add `provider` and an encrypted credentials reference to the business/tenant record, and
  register a resolver: `registerTenantProviderResolver((tenantId) => lookup(tenantId))`.
- Store credentials in a secret store keyed by tenant and provider. Adapters read them
  through a credentials accessor, not `process.env`, in that mode. Never put secrets in
  the browser, logs or the raw-event store.
- Own numbers per provider: a `BusinessPhone` row names its provider, so outbound caller ID
  and inbound routing use the number's own provider even after the tenant default changes.
- Inbound routing is by **URL path** (`/api/comms/<provider>/...`) plus the dialled number,
  so a callback for a number still on the old provider is verified with the old provider's
  credentials. Tenant is derived from the number, never from the caller or a header.
- History stays linked to the provider that carried it (`Call.provider`), and recordings
  are fetched or deleted with the provider that made them.
- **Isolation tests** (§10): tenant A's callback signed with tenant B's key is rejected,
  and tenant A can never read tenant B's calls via a provider ID.

**Do not** make `BusinessPhone.kind` carry the vendor, and do not add vendor-specific
tables. Vendor specifics belong in the adapter and in the redacted raw-event store.

## 8. Browser calling and agent experience

The UI keeps one dialer; the vendor SDK hides behind it.

```ts
type DialerStatus =
  "unavailable" | "connecting" | "ready" | "ringing" | "in-call" | "error"

interface DialerCapabilities {
  mute: boolean
  transfer: boolean
  deviceSelection: boolean
  inboundRing: boolean
  outbound: boolean // browser-originated dialling; false = server-placed only
}

interface Dialer {
  readonly capabilities: DialerCapabilities
  state: {
    status: DialerStatus
    muted: boolean
    seconds: number
    error?: string
  }
  incoming: {
    callId: string
    customer: string
    number?: string
    leadId?: string
  } | null
  register(): Promise<void> // fetch credential, create device
  answer(): void
  reject(): void
  mute(on: boolean): void
  hangup(): void
  setInputDevice(id: string | null): Promise<void>
}

// Application-facing hook; same shape for every provider.
const dialer = useCommunicationsDialer()
```

How this maps to the repository:

- `PhoneDock.tsx` already behaves like this (one per tab, a state machine,
  `ensureDevice`, mic selection, `callId` from custom parameters). Extract its Twilio
  `Device` code into `browser/twilio-dialer.ts` implementing `Dialer`; the dock and
  `CallModal` talk only to `useCommunicationsDialer`.
- **Outbound CRM calls are server-originated.** The server calls the lead, then bridges
  the answered leg to the agent's browser identity. A token therefore only needs to
  _receive_ calls, so it can never dial an arbitrary number. Keep that property for every
  provider.
- `GET /api/admin/voice/token` becomes provider-neutral: it authenticates the CRM user,
  maps them to the neutral identity (`clientIdentity(userId)`), calls
  `activeProvider().browser.issueCredential(identity, 600)` and returns
  `{ provider, token, identity, ttlSeconds, options }`. The client picks the dialer from
  `provider`. The response contains no API secret, only a short-lived credential.
- **Capability, not pretence.** Today only the Twilio dialer ships. For Plivo and Telnyx
  the backend can issue credentials (`browserCalling: true`) but the app does not bundle
  their SDKs (`browserSdkBundled: false`). The dialer reports `unavailable` with a clear
  message until the SDK adapter (Plivo Browser SDK, `@telnyx/webrtc`) is added. Do not
  fake it.
- Call history (`leadCalls`, `callProgress`), duration, status labels (`call-labels.ts`),
  and agent availability/ring order (`RingOrderField`) are CRM data and need no provider
  awareness.
- Transfer: not implemented in the app today. Define `transfer: false` for all providers
  until it is built; if built later, make it a `callControl` step (`dialNumber`) and
  advertise it per adapter.

Identity: the dialer identity is derived from the CRM user ID. Twilio uses it as the
JWT identity (`crm_<id>`); Plivo and Telnyx use it as the endpoint / credential name
(Telnyx credentials are one per device, so concurrent tabs need separate credentials; see
file 07).

## 9. Provider-specific operational work that is not configuration

Moving the _outbound_ and _SMS_ paths behind the interface is mechanical. These parts are
not, and need their own work per provider. List them in the cut-over plan.

| Area                                                                                                    | Twilio (today)                                                    | Plivo                                                                  | Telnyx                                                                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Inbound call flow (consent gate, forward with press-1 screening, ring CRM browsers, voicemail fallback) | TwiML routes in `app/api/twilio/voice/*`                          | Same logic rendered as Plivo XML via the DSL (`<GetDigits>`, `<Dial>`) | Event-driven commands (`answer`, `playback`, `gather`, `transfer`, `bridge`) |
| AI front office stream                                                                                  | Media Streams `<Connect><Stream>` + signed upgrade                | `<Stream bidirectional="true">`; codec in file 03 §6                   | `streaming_start` command; frame format **VERIFY**                           |
| Recording                                                                                               | Dial `record`, recording callback, authenticated download, delete | Free recording; callback and download per file 03                      | `record_start`, "recording saved" event, download link; **VERIFY**           |
| Whole-call rules (4-hour limit, caller-ID, AU Sydney edge)                                              | `timeLimit`, `edge=sydney`                                        | `time_limit`, check AU data region                                     | `time_limit_secs`; check region options                                      |

The recommended order is: SMS → outbound call + bridge to browser → call end/reconcile →
browser credential → inbound flow → recordings → AI stream. An adapter reports
`inboundCallFlow: false` until the inbound flow exists for it, and the inbound webhook
for a provider with `inboundCallFlow: false` must answer with the existing "not in
service" fallback (and log), not a half-built flow.

## 10. Tests to write

Mock external APIs. Use real captured payloads as fixtures where a `VERIFY` exists.

| #   | Area                               | Test                                                                                                                                                                          |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shared contract                    | One parameterised suite run against all three adapters: capabilities object is complete, `sendSms`/`placeCall` return a provider ID, errors are `CommsError`.                 |
| 2   | Adapters                           | Request shape per vendor (URL, auth header, body fields, number format) with `fetch`/SDK mocked.                                                                              |
| 3   | Factory                            | Unset → twilio; each value → that adapter; unknown → `config` error; tenant resolver wins; `providerFromPath` rejects unknown; `providerNameOfCallId` for each ID shape.      |
| 4   | SMS                                | Queue → `sendSms`; 4xx → `failed`; timeout/5xx/429 → `uncertain`; no retry.                                                                                                   |
| 5   | Call lifecycle                     | `placeCall` → `settleCallOriginate` accepted; cancel while ringing; end while answered; reconcile an ended call; reconcile a 404 → "not found" review state.                  |
| 6   | Signatures                         | Valid, tampered body, wrong URL, missing header, wrong token, previous-token overlap (Twilio/Plivo); Telnyx stale timestamp, wrong key, re-serialised body.                   |
| 7   | Normalisation                      | Fixture payload → exact `CommsEvent` for each event type per vendor, including Plivo digits-only numbers and Telnyx hangup causes.                                            |
| 8   | Duplicates / ordering              | Same event twice → one record; `completed` then late `ringing` → stays completed; `delivered` then late `sent` → stays delivered.                                             |
| 9   | Errors                             | Vendor error bodies map to `rejected`/`uncertain` with a stable `providerCode`.                                                                                               |
| 10  | Switching without business changes | Run the same CRM scenario (request call, SMS reply, status callbacks) with the factory set to each provider; assert identical database results and zero edits to domain code. |
| 11  | Tenant isolation                   | Tenant A's webhook signed with B's credentials → 403; A cannot resolve B's calls; resolver changes don't move in-flight calls.                                                |
| 12  | Unsupported capability             | `callControl.execute` on Plivo, `pause` on Telnyx, browser SDK on Plivo/Telnyx → `unsupported` / dialer `unavailable`; never a silent no-op.                                  |
| 13  | Architecture guard                 | Provider SDK imports and `provider === "` appear only where allowed (extends `tests/architecture.test.ts`).                                                                   |

### 10.1 Sandbox / test-account instructions

| Provider | Test account                                                                                                            | Safe testing                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Twilio   | Use a subaccount or trial account; Twilio's _test credentials_ cover only a few APIs and cannot place real calls to AU. | Magic numbers for messaging; for voice send to a verified personal number. Expose local ports with a tunnel and set `COMMS_WEBHOOK_ORIGIN` to it so signatures match.                             |
| Plivo    | Trial account (sandbox numbers restricted to verified destinations).                                                    | Use a Plivo sub-account for isolation. Capture one real signed callback and store it as a fixture to settle the `VERIFY` items.                                                                   |
| Telnyx   | Free account with a small credit; create a separate API key and messaging profile for testing.                          | Use a dedicated Call Control Application pointing at the tunnel. Telnyx can replay webhook deliveries from Mission Control; copy a delivery as a fixture and verify the Ed25519 check against it. |

In each case: put credentials only in `.env` (never committed), use the tunnel's HTTPS
origin as the webhook origin, and run one real SMS, one outbound call to a personal
mobile, and one status-callback replay before relying on fixtures.

## 11. Rollout plan for this repository

1. **Prerequisites.** Relax `isCallSid` to an opaque-ID check; add the nullable
   `provider` columns (one migration); add the architecture-guard test.
2. **Contracts + factory + Twilio adapter** wrapping existing code. Route `chat-reply`,
   `voice-worker`, the token route and the cron reconciler through the factory. Behaviour
   must be byte-for-byte unchanged with `COMMUNICATIONS_PROVIDER` unset. Existing Twilio
   tests must pass untouched.
3. **Dialer extraction.** Move the Twilio `Device` out of `PhoneDock.tsx` behind
   `useCommunicationsDialer`.
4. **Telnyx adapter** (SMS, outbound call, hangup, status, webhooks, credentials).
5. **Plivo adapter** from the existing pseudocode (file 03).
6. **Generic webhook routes** under `/api/comms/[provider]/*`.
7. **Inbound flow, recordings and AI stream** per provider (§9), one at a time, each
   behind its capability flag.
8. **Per-tenant resolver and credentials store**, only when a second business exists.

Keep each step a separate, reviewable change. Do not claim a provider is "supported"
until its capability flags are true and its sandbox checklist in
[file 05](./05-testing-migration-checklist.md) has passed.
