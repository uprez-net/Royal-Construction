# WhatsApp Business — operator runbook

Issue #333. Lead outreach over the official **Meta WhatsApp Business Platform
(Cloud API)**: staff message a lead from the leads list or the lead page, Eve
can read a thread and request a send with owner approval, and customer replies
arrive through a signed webhook onto the right lead.

This page is for whoever administers the Meta account and the deployment. It is
short on purpose; the reasoning lives in the code it names.

| What | Where |
| --- | --- |
| Business rules (who may be messaged, the window, consent, sending once) | `lib/domain/leads/whatsapp/` |
| Approved-template catalogue | `lib/domain/leads/whatsapp/templates.ts` |
| Configuration (all `WHATSAPP_*` variables) | `lib/whatsapp/config.ts`, documented in `.env.example` |
| Meta Cloud API adapter | `lib/whatsapp/cloud-api.ts` |
| Webhook | `app/api/whatsapp/webhook/route.ts` → `lib/whatsapp/webhook-handler.ts` |
| Phone backfill | `pnpm whatsapp:backfill-phones` (`scripts/backfill-lead-phone-e164.ts`) |

---

## 1. One-time Meta setup

Do this in the **Meta Business Suite / WhatsApp Manager** owned by Royal
Constructions — not a personal Facebook account, and not an agency's portfolio.
Record who administers it; there is no support desk to recover it.

1. **Business Portfolio.** Create or use Royal's Meta Business Portfolio and
   complete **business verification**. Unverified portfolios are limited in how
   many customers they can message.
2. **WhatsApp Business Account (WABA).** Create it inside that portfolio. Its id
   goes in `WHATSAPP_BUSINESS_ACCOUNT_ID`.
3. **Meta app.** Create a Business-type app at developers.facebook.com, add the
   **WhatsApp** product, and link it to the WABA. The app's **App Secret**
   (App settings → Basic) goes in `WHATSAPP_APP_SECRET`.
4. **Phone number(s).** Add each dedicated business number to the WABA, verify
   it, set **two-step verification**, and get the **display name** approved. A
   number already used in the WhatsApp Business *app* must be migrated or used
   in coexistence mode — check Meta's current rules before moving the number
   the office relies on today.
5. **Permanent token.** Create a **System User** in the portfolio, assign it
   the app and the WABA, and generate a token with `whatsapp_business_messaging`
   and `whatsapp_business_management`. It goes in `WHATSAPP_ACCESS_TOKEN`. Never
   use the 24-hour temporary token from the API-setup page outside a quick test.
6. **Configure the numbers** for this deployment:

   ```
   WHATSAPP_PHONE_NUMBERS="<phone_number_id>=<+61…>=Office,<phone_number_id>=<+61…>=Sales"
   WHATSAPP_DEFAULT_PHONE_NUMBER_ID="<phone_number_id of the default sender>"
   ```

   `phone_number_id` is the id shown in WhatsApp Manager → API setup, **not**
   the number. **Record here which number is the default outbound sender:**
   _(to be filled in at rollout — e.g. "Office, +61 2 …")_. A reply to a
   customer whose 24-hour window is open always goes from the number they wrote
   to, whatever the default is.
7. Turn it on: `WHATSAPP_ENABLED="true"`. Anything else leaves the channel off.

## 2. Webhook

1. Generate a verify token (`openssl rand -hex 32`) and set
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Deploy.
2. In the Meta app → WhatsApp → Configuration → **Webhook**:
   - Callback URL: `https://<app host>/api/whatsapp/webhook`
   - Verify token: the same value.
   Meta calls `GET` with `hub.challenge`; the route echoes it only when the token
   matches.
3. **Subscribe the `messages` field.** That one field carries both inbound
   messages and delivery statuses (sent / delivered / read / failed).

How it behaves, so a log line makes sense:

- Every `POST` is checked against `X-Hub-Signature-256` (HMAC-SHA256 of the raw
  body with the App Secret) **before** it is parsed. No secret, no header or a
  wrong signature → `401`, nothing written.
- A delivery naming a WABA other than `WHATSAPP_BUSINESS_ACCOUNT_ID` → `403`.
- `200` is only returned after every message and status in the delivery is
  written. A database problem → `500`, and Meta retries for up to **7 days**.
  Retries are harmless: everything is keyed on Meta's message id.
- Logs carry counts, message ids and error codes — never message text or phone
  numbers.

## 3. Templates

Outside the customer-service window WhatsApp only delivers a template Meta has
approved, with exactly the approved wording. The app's catalogue must match
WhatsApp Manager **byte for byte**, or the send fails with code `132000`/`132001`.

To add or change one:

1. Submit it in WhatsApp Manager → Message templates (category, name, language,
   body with `{{1}}`, `{{2}}` … and a sample for each). Wait for approval.
2. Add/update the entry in `lib/domain/leads/whatsapp/templates.ts`: same
   `name`, same `language` code, the same `body` text, one `parameters` entry
   per variable in order. Ship it through code review — it is text customers
   read.
3. If a deployment's account lacks some catalogue templates (the Meta test
   number has none of ours), list the ones it has in
   `WHATSAPP_ENABLED_TEMPLATES`, comma-separated. Unset means all.

Current catalogue — submit these exactly (language `en`):

| Name | Body | Samples |
| --- | --- | --- |
| `lead_enquiry_follow_up` | `Hi {{1}}, it's Royal Constructions following up on your enquiry about {{2}}. Reply here whenever suits and we'll pick it up with you, or let us know a good time to call.` | `{{1}}` Sam · `{{2}}` your new home in Kellyville |
| `lead_missed_contact` | `Hi {{1}}, it's Royal Constructions. We tried to reach you about your building enquiry. Reply to this message and we'll get back to you.` | `{{1}}` Sam |

Meta decides the category (utility vs marketing) on review; marketing templates
are priced differently and can be refused delivery to customers who have muted
marketing (`131049`/`131050`).

## 4. The rules staff will run into

- **Usable phone.** Only the lead's **primary** phone, and only when it parses
  to a valid number (read as Australian when it has no country code). Otherwise
  the WhatsApp action is disabled with the reason.
- **24-hour window.** Free-form text is only allowed within 24 hours of the
  customer's last message to that business number (Meta's customer-service
  window; checked against Meta's docs in September 2026 — a customer *call* also
  opens it on Meta's side, which the app does not model yet). Outside it, only a
  template.
- **Consent.** A valid number is not consent. A template (proactive outreach)
  needs WhatsApp consent recorded on the lead — how they agreed and when —
  unless the customer has written in within 24 hours. Staff record or withdraw
  it from the WhatsApp conversation. An **opt-out** blocks every send until fresh
  consent is recorded.
- **Archived leads** cannot be messaged.
- **Pricing.** Meta charges per template message, and third-party notices say
  service messages inside the window become chargeable from 1 October 2026.
  Confirm current rates in WhatsApp Manager.

## 5. Unmatched and ambiguous numbers

An inbound message is attached to a lead only when **exactly one** lead has
that number (`Lead.phoneE164`). Otherwise it waits in the **unmatched WhatsApp
review queue** (Leads → unmatched WhatsApp; API `/api/leads/whatsapp/unmatched`):

- `NO_MATCH` — no lead has the number. Attach it to the right lead, or dismiss
  it. The app never creates a lead from an inbound number.
- `AMBIGUOUS` — several leads share the number. Pick the right one; consider
  merging or correcting the duplicates (the phone backfill lists them).
- `UNKNOWN_BUSINESS_NUMBER` — it reached a Royal number this deployment is not
  configured for. Fix `WHATSAPP_PHONE_NUMBERS`.

Attaching files the message on the lead exactly as if it had matched (opens
the window, counts as unread). Dismissing keeps it on record. Nothing is ever
discarded.

## 6. Failed and unconfirmed sends

Every send has a durable intent (`OutboxEvent`, kind `LEAD_WHATSAPP_SEND`, key
`lead-whatsapp:<leadId>:<idempotency key>`) written before Meta is called.

- **Failed** (Meta refused, or could not be reached): nothing reached the
  customer. The thread shows why in plain words; pressing Send again retries the
  same message.
- **Unconfirmed** (timeout, dropped connection, Meta 5xx): Meta may have
  delivered it. It is **not** retried. The thread flags it; check the
  conversation in WhatsApp Manager (or the business phone), then mark it
  **sent** or **not sent** in the app. Only then send again.
- A send stuck in progress after a crash shows as "already being sent"; find the
  `OutboxEvent` by its key (status `RUNNING`) and reconcile it the same way.
- A double-click, a retry after a timeout, or Eve replaying a tool call never
  sends twice; the app says "already sent" instead.

## 7. Secret rotation

| Secret | How |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Generate a new System User token, set it, redeploy, then revoke the old one. Sends fail with "access token expired" (`190`) until the new one is live. |
| `WHATSAPP_APP_SECRET` | Reset it in the Meta app, set it, redeploy promptly. Deliveries signed with the new secret get `401` until the deploy lands; Meta retries them. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Set the new value, redeploy, then re-save the webhook in the Meta app with it (only the handshake uses it). |

## 8. Rollout

1. Apply the migration (`pnpm prisma:migrate-deploy`), then run the phone
   backfill: `pnpm whatsapp:backfill-phones` (dry run), review the INVALID and
   SHARED lists, then `pnpm whatsapp:backfill-phones --commit`. Until it runs,
   replies from existing leads go to the review queue instead of their lead.
2. **Staging with Meta's test number** first: add your own phone as a test
   recipient, set `WHATSAPP_ENABLED_TEMPLATES` to what the test account has,
   and check a template send, a reply, a free-form reply inside the window,
   delivered/read ticks, an unknown-number message landing in review, and a
   refused send's message.
3. **One production number.** Watch failures and the review queue for a week.
4. Add further numbers to `WHATSAPP_PHONE_NUMBERS` only once the first is
   stable.

## 9. Eve

Eve's lead specialist can read a lead's WhatsApp thread and summary, request a
send and schedule a WhatsApp follow-up. It calls the same domain commands as
the app, so every rule above applies unchanged, and:

- every send needs the **session owner's approval** in the agent workspace;
- Eve never records an inbound message or a delivery status — only the signed
  webhook can;
- if WhatsApp is not configured in Eve's runtime it answers "provider
  unavailable — send it from the app or reconcile the outbox" and never claims
  a message went out;
- Eve cannot record consent; that comes from the person who heard it.
