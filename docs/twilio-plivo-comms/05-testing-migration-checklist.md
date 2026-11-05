# 5. Testing, migration and launch checklist

## 1. Build order (any project)

Each phase is shippable on its own. Do not start a phase until the previous phase's
acceptance tests pass on a real test number.

| Phase | Build                                                                                                                   | Acceptance                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Primitives, config, data model, `WebhookDelivery` ledger, outbox worker ([file 01](./01-architecture-and-contracts.md)) | Unit tests for `normalizeE164`, `applyStatus` and the outbox `uncertain` path.                                                                                                                                  |
| 1     | Adapter: signature verification + REST client                                                                           | Test vectors pass ([Twilio](./02-twilio-setup-and-pseudocode.md#2-webhook-signature-x-twilio-signature), [Plivo](./03-plivo-setup-and-pseudocode.md#2-webhook-signature-v3)); one real signed request verifies. |
| 2     | SMS in/out + status + STOP handling                                                                                     | Two-way SMS with a real AU mobile; status reaches `delivered`; `STOP` blocks the next marketing send.                                                                                                           |
| 3     | Inbound PSTN → staff mobile/browser, `dial-complete`, voicemail/callback task                                           | Answered, busy, no-answer and caller-hang-up-while-ringing paths all produce correct `Call` rows.                                                                                                               |
| 4     | Browser softphone: token, inbound ring, outbound dial, destination allow-list                                           | Staff without a session cannot get a token; `000`/`19xx`/international numbers are refused.                                                                                                                     |
| 5     | Recording consent + recording pipeline + provider-copy deletion                                                         | Declined consent produces no recording; an accepted recording is stored privately and deleted at the provider.                                                                                                  |
| 6     | AI agent stream + hand-over                                                                                             | First AI audio reaches the caller within 1.5 s of answer; barge-in clears audio; hand-over rings staff with a summary.                                                                                          |
| 7     | WhatsApp messaging: inbound, free-form inside the window, templates outside it, media copy                              | Free-form outside 24 h is blocked locally before the provider; an approved template delivers; status reaches `read`.                                                                                            |
| 8     | WhatsApp calling: inbound to browser, permission request/reply, outbound, quotas                                        | Inbound WA call rings the browser; a permission grant is stored with evidence; a 6th call in 24 h is blocked locally.                                                                                           |
| 9     | Observability, spend alerts, runbook                                                                                    | Alerts fire in a staged test; the runbook covers token rotation and webhook-URL changes.                                                                                                                        |

## 2. Test strategy

### Fixtures first

For every webhook kind, capture one **real** signed request from a test account (headers +
raw body + public URL) and save it with secrets replaced. Each fixture needs:

```
fixtures/<provider>/<kind>.json
{ "method": "POST", "url": "https://…/webhooks/plivo/voice/answer", "headers": { … },
  "rawBody": "CallUUID=…&From=…", "authTokenForTest": "fixture_token_only" }
```

Re-sign fixtures with a test token (using your own signer) so that tests never need real
secrets. Every `VERIFY` item in files 02 and 03 must end up covered by a fixture.

### Required automated tests

- Signature: valid, tampered body, tampered query, wrong token, previous token accepted,
  replayed nonce (Plivo) rejected, oversized body rejected.
- Dedupe: the same delivery twice → one side effect, the same response.
- Out-of-order status: `delivered` then `sent` → stays `delivered`; `failed` is terminal.
- Outbox: timeout → `uncertain` → no automatic resend; reconcile matches an existing
  provider message.
- Router: every DSL output renders to well-formed XML for **both** adapters (parse it back).
- XML escaping: a caller name containing `<&">` is escaped in every attribute and text node.
- Stream codec: decode → encode round trip for start/media/mark/clear on both providers;
  frames before `start` close the socket; an invalid or expired session token closes the
  socket.
- Policy: WhatsApp window boundary at exactly 24 h; template required; quiet hours;
  unsubscribed contact.
- WhatsApp permission: rate limits (1/24 h, 2/7 days), 5 calls/24 h, expiry, revocation
  after missed calls.

### Manual acceptance on real AU numbers

- [ ] Telstra, Optus and Vodafone handsets: inbound, outbound and SMS each way.
- [ ] Caller ID shown on the staff phone when forwarding (customer's number or business number).
- [ ] WhatsApp call from Android and from iOS; DTMF consent works or the fallback (unrecorded) path is used.
- [ ] A long SMS with an emoji is billed as the expected number of UCS-2 segments.
- [ ] Spend for the test day matches the [file 04](./04-au-cost-comparison.md) formulas within 5%.

### Provider-agnostic additions

These apply once the layer in [file 06](./06-provider-agnostic-architecture.md) exists.

- One contract suite runs against the Twilio, Plivo and Telnyx adapters (same inputs, same
  neutral outputs, errors are `CommsError`).
- Factory: unset env selects Twilio; each value selects its adapter; an unknown value fails
  loudly; a tenant resolver overrides the default; existing call IDs resolve to their owning
  provider.
- Telnyx signature: valid; stale timestamp (over 5 minutes); wrong key; re-serialised body;
  missing headers.
- Plivo V3 signature: valid; tampered param; wrong nonce; multi-signature header; previous
  token accepted.
- Normalisation fixtures: captured real payloads per provider produce the expected
  `CommsEvent`, including Plivo digits-only numbers and Telnyx hangup causes.
- Switching: the same CRM scenario produces identical database results for each provider.
- Tenant isolation: a callback signed for tenant A is rejected for tenant B.
- Unsupported capability: Plivo live-call commands, Telnyx `pause`/`redirect` and a missing
  browser SDK return `unsupported`/`unavailable`, never a silent no-op.

## 3. Migration plan: Twilio to Plivo or Telnyx

The steps below are written for Plivo. For **Telnyx** substitute its setup
([file 07 section 1](./07-telnyx-setup-and-pseudocode.md#1-account-and-console-setup)) and
set `COMMUNICATIONS_PROVIDER=telnyx`. Telnyx handles inbound ringing, voicemail and
recording in this repository (see the [runbook](../comms-runbook.md)); it has no AI
stream support. Existing numbers, active calls, recordings and approvals do **not** migrate
automatically.

**Plivo is not implemented yet.** `COMMUNICATIONS_PROVIDER` (legacy alias `COMMS_PROVIDER`)
accepts only `twilio` or `telnyx`; the Plivo-specific steps below cannot be completed until
a Plivo adapter ships.

Only start this after the neutral layer exists and Twilio runs through the Twilio adapter.

### Step 1: Parallel setup (no customer impact)

1. Complete the Plivo setup ([file 03 §1](./03-plivo-setup-and-pseudocode.md#1-account-and-console-setup)) in a
   staging sub-account with a **new** AU mobile number.
2. Deploy the Plivo adapter and routes alongside the Twilio ones. Webhooks are namespaced by
   provider, so both work at once.
3. Run the phase 1–8 acceptance tests against the Plivo staging number.

### Step 2: Decide the number strategy

| Option                                        | Effect                                                                                                                                                          | Risk                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Port the existing AU number** to Plivo      | Customers keep the number. Needs a Plivo port request, a letter of authorisation and a matching compliance application. Twilio releases the number at cut-over. | Port windows can fail or slip; plan a rollback window; SMS/WhatsApp gap during the port. |
| **New Plivo number**, keep Twilio for a while | No porting. Announce the new number, and forward or auto-reply on the old one during overlap.                                                                   | Two numbers to pay for during overlap; customer confusion.                               |

### Step 3: WhatsApp

A WhatsApp sender belongs to a WABA through one provider (BSP) at a time. Moving it means:

1. Check with Meta and both providers whether the WABA/number can be **migrated** between
   BSPs (Meta supports phone-number migration between WABAs/BSPs; the flow and downtime
   differ). Otherwise register the number fresh after removing it from Twilio.
2. **Templates do not follow automatically** unless the WABA itself moves. Export template
   names, language, category and body. Recreate them and wait for approval **before**
   cut-over. Map Twilio `ContentSid` → Plivo template `name` in the `Template` table.
3. Call permissions granted to the old sender may not carry over. Treat all grants as
   `none` after a sender change unless the provider confirms otherwise.
4. The quality rating and messaging limits are tied to the number/WABA. A brand-new number
   starts at the lowest tier.

### Step 4: Cut-over

1. Set `COMMUNICATIONS_PROVIDER` to the new provider (`twilio` or `telnyx` today) for **new
   outbound** work. Inbound continues to be handled by whichever provider owns each number.
   For a Plivo migration this step is blocked: `plivo` is not an accepted value until the
   Plivo adapter is supported.
2. Port the number (or switch WhatsApp/voice configuration) during low traffic, and watch
   signature failures, unknown-number webhooks and outbox `uncertain` jobs.
3. Keep the Twilio adapter, routes and credentials for **30 days**, for late callbacks
   (recordings, status) and rollback.
4. Copy any recordings you must keep from Twilio to private storage, then delete them at
   Twilio. Close Twilio numbers after the overlap.

### Rollback

Flip `COMMUNICATIONS_PROVIDER` back for outbound. A port cannot be undone quickly, so for voice and SMS
the rollback for a ported number is a port back (days). This is why the 30-day dual-adapter
overlap and a pre-agreed rollback window with the provider matter.

## 4. Launch checklist (either provider)

- [ ] Production subaccount/sub-account; MFA; secrets in the secret store; no secrets in logs.
- [ ] `COMMS_WEBHOOK_ORIGIN` matches the console URLs exactly; fallback URLs set and static.
- [ ] Number regulatory bundle/compliance application approved; mobile number has voice + SMS.
- [ ] Spam Act: consent capture, sender identification, `STOP` handling; alpha sender IDs
      registered with ACMA if used.
- [ ] Recording: announcement, consent capture, a recording-free path; retention and
      deletion jobs; the privacy policy names the providers and overseas processing.
- [ ] WhatsApp: business verification, display name approved, templates approved, call hours
      and callback permission configured, permission limits enforced locally.
- [ ] Do Not Call Register check for outbound telemarketing.
- [ ] Destination allow-list: AU only; block `000`, `112`, `19xx` premium, international.
- [ ] Spend: balance alerts, daily usage alerts per category, auto-recharge ceiling.
- [ ] Runbook: token rotation, webhook-URL change, provider outage (fallback message), port
      rollback contacts.
- [ ] Re-pricing checklist in [file 04 §7](./04-au-cost-comparison.md#7-re-pricing-checklist-run-before-any-quote) completed within the last 30 days.
