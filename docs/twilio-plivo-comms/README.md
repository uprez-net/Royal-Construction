# Portable SMS, voice and WhatsApp playbook: Twilio, Plivo and Telnyx (Australia)

Research date: **28 October 2026**. Region: **Australia (AU) only**: AU numbers, AU
customers, AU destinations. Currency: **USD is the canonical currency** (both providers
publish and bill in USD). Every table also shows AUD at a fixed planning rate of
**USD 1 = AUD 1.50**. See [cost comparison](./04-au-cost-comparison.md#currency-tax-and-method).

This folder tells a coding agent how to build these features in **any** project, in any
language, without a provider SDK:

- SMS send/receive and delivery status
- PSTN voice: inbound routing, forwarding to staff, browser calling, recording, IVR
- An AI voice agent over a bidirectional audio WebSocket
- WhatsApp Business messaging: free-form, templates, media, delivery/read status
- WhatsApp Business Calling: inbound, outbound with permission, browser answering

It also covers implementing each feature on **Twilio** (the current provider), **Plivo** or
**Telnyx** (the alternatives), and switching between them through one provider-agnostic
layer. [File 06](./06-provider-agnostic-architecture.md) maps that layer onto this
repository: what is Twilio-specific today, the interfaces, the factory, webhook
normalisation, per-tenant selection and the browser dialer.

> **Status of this folder.** These are design and setup documents. At the time of writing
> only Twilio is implemented in code; the Plivo and Telnyx material is a plan, with items
> marked `VERIFY` still to be confirmed against a live account.

## Read order

1. [Architecture and contracts](./01-architecture-and-contracts.md). Provider-neutral data
   model, the `CommsProvider` port, webhook pipeline, state machines and the call
   instruction DSL. **Build this first.** Everything else plugs into it.
2. [Twilio setup and pseudocode](./02-twilio-setup-and-pseudocode.md)
3. [Plivo setup and pseudocode](./03-plivo-setup-and-pseudocode.md)
4. [AU cost comparison](./04-au-cost-comparison.md). Rate cards, per-route costs and monthly
   scenarios in USD and AUD.
5. [Testing, migration and launch checklist](./05-testing-migration-checklist.md)
6. [Provider-agnostic architecture for this repository](./06-provider-agnostic-architecture.md).
   Current Twilio coupling, interfaces, factory, config, events, tenancy, dialer, tests and
   rollout order.
7. [Telnyx setup and pseudocode](./07-telnyx-setup-and-pseudocode.md)

## Rules for the implementing agent

1. **No provider SDK is required.** All pseudocode uses raw HTTPS, HMAC, base64, JSON, XML
   strings and WebSockets. You may use an official SDK where the project already has one,
   but the adapter must still satisfy the contracts in file 01.
2. **Use only the primitives listed in [file 01 §1](./01-architecture-and-contracts.md#1-primitives-the-host-project-must-supply).**
   Map each one to whatever the host project already uses (any HTTP client, any DB, any
   queue). Do not add a framework to satisfy a primitive.
3. **Provider details marked `VERIFY` were not confirmed from primary docs on the research
   date**, or the provider's own docs contradict each other. Before coding against a
   `VERIFY` item, capture one real signed request or response from a test account, store it
   as a fixture, and code against the fixture.
4. **Never trust the webhook body before verifying its signature.** Never trust caller ID for
   authorization.
5. **Prices change.** Re-check every rate in file 04 on the provider pages before quoting.
   The tables there record the values and pages read on the research date.

## Decision summary

| Question                                    | Answer                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is Telnyx supported?                        | Designed, not built. File 07 documents SMS, outbound voice, webhooks and browser credentials. Its call model is REST commands, not markup. Inbound flow, recording and AI streaming for Telnyx are not verified. Pricing was **not** researched. |
| Can Plivo do everything we use Twilio for?  | Yes for SMS, PSTN voice, browser calling, recording, IVR, AI audio streaming, WhatsApp messaging and WhatsApp calling. No Plivo equivalent was found for Twilio ConversationRelay (managed STT/TTS relay).                                       |
| Is Plivo cheaper in AU?                     | Yes. About **4–5%** cheaper at pilot volume and **14–16%** at regular/busy volume on list prices. See [file 04](./04-au-cost-comparison.md#5-monthly-scenarios).                                                                                 |
| Where is the biggest saving?                | Free recording, free audio streaming, cheaper WhatsApp provider fee (USD 0.001 vs 0.005 per message) and cheaper SMS. PSTN minute prices are close.                                                                                              |
| Where is Plivo more expensive?              | Small WhatsApp volumes: Plivo adds **USD 10/month per WhatsApp Business Account** from 1 November 2026. Twilio has no monthly WhatsApp fee.                                                                                                      |
| What costs the same on both?                | Meta's WhatsApp template, service-message and business-initiated call fees. Both providers pass these through.                                                                                                                                   |
| What dominates the bill?                    | Outbound SMS and calls to AU mobiles. Route choice (staff mobile vs browser/SIP) matters more than provider choice.                                                                                                                              |
| Can WhatsApp calls be forwarded to a phone? | **No, on either provider.** Staff must answer in a browser/app (WebRTC) or SIP endpoint.                                                                                                                                                         |
| Should we migrate?                          | Only if the saving justifies the re-onboarding work: new number compliance, a new WhatsApp sender, template re-approval, and a re-test of every flow. See [file 05](./05-testing-migration-checklist.md#3-migration-plan-twilio-to-plivo).       |

## Feature parity matrix

| Capability                | Twilio                                                     | Plivo                                                                              |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Call control markup       | TwiML (`application/xml`)                                  | Plivo XML (`application/xml`)                                                      |
| Webhook encoding          | Form-encoded                                               | Form-encoded POST or GET query, per configured method                              |
| Webhook signature         | `X-Twilio-Signature`, HMAC-SHA1                            | `X-Plivo-Signature-V3` + nonce, HMAC-SHA256                                        |
| REST auth                 | Basic: API Key SID/Secret (preferred) or Account SID/Token | Basic: Auth ID/Auth Token (sub-accounts for isolation)                             |
| REST body                 | Form-encoded                                               | JSON                                                                               |
| Number format in webhooks | E.164 with `+`; WhatsApp `whatsapp:+61…`                   | Digits without `+` are common (`61412…`); normalize everything. `VERIFY` per event |
| Browser calling           | Voice JS SDK + Access Token (JWT, HS256)                   | Browser SDK + Endpoint (SIP user) credentials or JWT                               |
| AI audio WebSocket        | Media Streams `<Connect><Stream>`                          | `<Stream bidirectional="true">`                                                    |
| Managed voice-AI relay    | ConversationRelay (USD 0.07/min)                           | No equivalent found; use streaming + own STT/LLM/TTS                               |
| Recording                 | Paid per minute + storage                                  | Free; storage free 90 days                                                         |
| WhatsApp templates        | Content API (`ContentSid` + variables)                     | Meta-style `template` object in Message API                                        |
| WhatsApp calling          | Yes (Business Calling, US1 voice app per earlier research) | Yes (enable per number; Call API `call_type`)                                      |
| AU data region            | AU1 (Sydney) region exists; check per-product support      | `VERIFY` Plivo data-region options for AU                                          |

### Telnyx, for comparison

| Capability         | Telnyx (see [file 07](./07-telnyx-setup-and-pseudocode.md))                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Call control       | REST commands plus JSON event webhooks (Call Control); no markup response                              |
| Webhook encoding   | JSON (`data.event_type`, `data.payload`)                                                               |
| Webhook signature  | `telnyx-signature-ed25519` over `timestamp` + `\|` + raw body, Ed25519; reject if older than 5 minutes |
| REST auth          | `Authorization: Bearer <API key>`                                                                      |
| Number format      | E.164 with `+`                                                                                         |
| Browser calling    | Telephony credentials + JWT login token, `@telnyx/webrtc`; one credential per device                   |
| AI audio WebSocket | "Streaming start" command exists; frame format `VERIFY`                                                |
| Recording          | "Recording start" command and saved-recording event; details `VERIFY`                                  |
| WhatsApp           | Not researched                                                                                         |

## Australian compliance (applies to every provider)

These are product requirements, not provider features. Build them into the neutral layer.

- **Spam Act 2003 (commercial SMS/WhatsApp marketing):** consent, clear sender
  identification and a working unsubscribe. Store consent evidence per contact and channel
  and honour `STOP` keywords immediately.
- **SMS Sender ID Register (ACMA):** alphanumeric sender IDs must be registered before use.
  Confirm current status before sending from an alpha sender. Number senders are
  unaffected.
- **Call recording:** recording laws differ by state. Announce recording, capture consent
  before you start recording, and support recording-free calls. Consent to a WhatsApp call
  is **not** consent to record it.
- **Privacy Act / APP 8:** recordings, transcripts and message content sent to an overseas
  provider are cross-border disclosures. Update the privacy policy, minimise retention and
  delete provider copies after you copy media to your own storage.
- **Number regulatory bundle:** AU numbers on both providers need identity and address
  evidence. Mobile numbers need an Australian, non-PO-box address for voice + SMS
  capability. Allow days for review.
- **Do Not Call Register:** check it before outbound telemarketing calls.

## Sources read on the research date

- Plivo: [AU voice pricing](https://www.plivo.com/voice/pricing/au/),
  [AU SMS pricing](https://www.plivo.com/sms/pricing/au/),
  [AU WhatsApp pricing](https://www.plivo.com/whatsapp/pricing/au/),
  [WhatsApp call pricing](https://www.plivo.com/whatsapp/call-pricing/),
  [WhatsApp calling](https://docs.plivo.com/docs/voice/concepts/whatsapp-calling),
  [Make a call](https://www.plivo.com/docs/voice/api/call/make-a-call),
  [Send a message](https://www.plivo.com/docs/messaging/api/message/send-a-message),
  [Signature validation](https://www.plivo.com/docs/voice/concepts/signature-validation),
  [Stream XML](https://plivo.com/docs/voice-agents/audio-streaming/xml/stream),
  [Audio streaming protocol](https://docs.plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-reference),
  [Record XML](https://www.plivo.com/docs/voice/xml/record),
  [Regulatory compliance](https://plivo.com/docs/numbers/regulatory-compliance),
  [docs index](https://plivo.com/docs/llms.txt),
  [reference signature implementation](https://github.com/plivo/plivo-python/blob/master/plivo/utils/signature_v3.py).
- Twilio: [AU voice pricing](https://www.twilio.com/en-us/voice/pricing/au),
  [AU SMS pricing](https://www.twilio.com/en-us/sms/pricing/au),
  [WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing),
  [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
  [WhatsApp Business Calling](https://www.twilio.com/docs/voice/whatsapp-business-calling),
  [AU regulatory guidelines](https://www.twilio.com/en-us/guidelines/au/regulatory).
- Meta: [WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing),
  [Calling API pricing](https://developers.facebook.com/docs/whatsapp/cloud-api/calling/pricing).
- Telnyx: [Receiving webhooks](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks),
  [Telephony credentials](https://developers.telnyx.com/docs/voice/webrtc/auth/telephony-credentials),
  [docs index](https://developers.telnyx.com/llms.txt), read 3 November 2026.
- Within this repository, see [docs/phone](../phone/README.md) for the CitizenTechies-specific
  Twilio plans. This folder is project-agnostic and does not depend on them.
