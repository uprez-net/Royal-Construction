# WhatsApp bridge — the contract between the app and the bridge

Project WhatsApp groups (the owners, the office and site in one chat) run on
Royal's own WhatsApp number through **the WhatsApp bridge**: a small service in
[`services/whatsapp-bridge`](../services/whatsapp-bridge) that holds one
WhatsApp session, linked by QR code the way WhatsApp Web is, using
[Baileys](https://baileys.wiki/introduction). It runs on its own server, not on
Vercel, because a WhatsApp session is a long-lived socket.

Meta's WhatsApp Business API is still used — for **leads only** (1:1 messages,
templates, calls; [`docs/whatsapp-runbook.md`](./whatsapp-runbook.md)). Its
Groups API needed an Official Business Account Royal never had, capped groups
at eight people and could not see a group made on a phone, so every Meta group
code path was removed.

This page is the agreement both sides code to. Change it, the bridge
(`services/whatsapp-bridge/src/http/app.ts`, `src/events/types.ts`) and the app
(`lib/whatsapp-bridge/`) together.

```
            app → bridge: HTTPS + Bearer BRIDGE_API_TOKEN
 ┌─────────────────────────┐  ───────────────────────────────▶  ┌────────────────────────┐
 │ Royal app (Vercel)      │                                    │ WhatsApp bridge        │
 │ lib/whatsapp-bridge/    │  ◀───────────────────────────────  │ services/whatsapp-     │
 │ /api/whatsapp-bridge/   │   bridge → app: signed events      │ bridge (Docker)        │
 │   webhook               │   HMAC(BRIDGE_WEBHOOK_SECRET)      │  ↕ WhatsApp (Baileys)  │
 └─────────────────────────┘                                    └────────────────────────┘
```

| Where | What |
| --- | --- |
| Business rules (create, link, unlink, send, inbound) | `lib/domain/projects/whatsapp/` |
| The port the domain sees | `lib/domain/ports/whatsapp-bridge.ts` |
| The app's adapter (calls the bridge) | `lib/whatsapp-bridge/client.ts` |
| The app's webhook (receives events) | `app/api/whatsapp-bridge/webhook/route.ts` → `lib/whatsapp-bridge/webhook-handler.ts` |
| Admin page | `app/(main)/admin/whatsapp-bridge/page.tsx` |
| The bridge | `services/whatsapp-bridge/` ([README](../services/whatsapp-bridge/README.md)) |

---

## 1. Who owns what

- **The app is the source of truth** for which group belongs to which project
  (`ProjectWhatsAppGroup`, one per project, keyed by the group's id
  `…@g.us`).
- **The bridge keeps a copy of that mapping** (`DATA_DIR/mappings.json`) for one
  reason: it forwards events **only for mapped groups**. Every other chat on
  Royal's number — family, suppliers, a lead's 1:1 — never leaves the bridge.
- The app pushes each link (`PUT /v1/mappings/:jid`) **before** it commits it,
  and each unlink (`DELETE`) after. Creating a group passes `projectId`, so the
  bridge maps it before answering. `PUT /v1/mappings` replaces the whole set
  and is run by the daily sweep and by *Resync* on the admin page, so a missed
  push is repaired within a day.
- A message the bridge forwards for a group the app has no live link for is
  answered `200 {"outcome":"unknown_group"}` and logged: not retried (it would
  block the queue), not filed anywhere.

## 2. Authentication

**App → bridge.** Every `/v1/*` route requires
`Authorization: Bearer <BRIDGE_API_TOKEN>`, compared in constant time. The app
holds the same value as `WHATSAPP_BRIDGE_API_TOKEN`. `/healthz` is open and says
only whether the process is up and the session state.

**Bridge → app.** Every event is POSTed to `APP_WEBHOOK_URL`
(`https://<app>/api/whatsapp-bridge/webhook`, public in `proxy.ts`) with:

```
X-Bridge-Timestamp: <unix seconds>
X-Bridge-Signature: sha256=<hex HMAC-SHA256(BRIDGE_WEBHOOK_SECRET, "<timestamp>.<raw body>")>
X-Bridge-Event-Id:  <event id>
```

The app verifies over the raw bytes before parsing, and refuses a timestamp more
than five minutes from its clock. The app holds the secret as
`WHATSAPP_BRIDGE_WEBHOOK_SECRET`. Generate both secrets with
`openssl rand -hex 32` (the bridge refuses to start with one under 32
characters).

## 3. The bridge's API

All bodies are JSON. Every error is

```json
{ "error": { "code": "not_connected", "message": "A sentence the office can read." } }
```

The `message` is shown to staff as it is. The `code` is what the app branches
on:

| Code | HTTP | Meaning | A send with this code… |
| --- | --- | --- | --- |
| `unauthorized` | 401 | Wrong or missing token | was not sent |
| `bad_request` | 400 | The input is wrong (not a group id, not E.164, no `Idempotency-Key`) | was not sent |
| `not_found` | 404 | Royal's number is not in that group / no such file | was not sent |
| `in_progress` | 409 | The same `Idempotency-Key` is being sent right now | was not sent |
| `not_admin` | 422 | Royal's number must be an admin (invite link, adding people) | was not sent |
| `not_connected` | 503 | The session is not open — scan the QR | was not sent |
| `whatsapp_refused` | 502 | WhatsApp refused before anything left | was not sent |
| `send_unconfirmed` | 504 | WhatsApp did not confirm — **may have been delivered** | is held for a person |
| `whatsapp_timeout` | 504 | WhatsApp did not answer (non-send calls) | — |

A request that gets no answer at all is treated by the app as
`send_unconfirmed` for a send.

### Session

| Route | Does |
| --- | --- |
| `GET /v1/session` | `{ status, account, qrAvailable, qrIssuedAt, lastDisconnect, outbox, updatedAt }` |
| `POST /v1/session/connect` | Start connecting (and so a QR when not linked). `202`, idempotent. |
| `GET /v1/session/qr` | `{ qr, dataUrl, issuedAt }` while `awaiting_qr`, else `404 no_qr`. `dataUrl` is a PNG. |
| `POST /v1/session/logout` | Unlink the device on WhatsApp and wipe its keys. Stays `logged_out` until `connect`. |
| `POST /v1/session/restart` | Drop the socket and reconnect with the saved keys. |

`status` is one of `starting`, `connecting`, `awaiting_qr`, `open`,
`logged_out`, `closed`. `account` is `{ jid, phoneE164, name }` once open.
`outbox` is `{ pending, dead, delivering, lastDeliveredAt, lastError,
lastErrorAt }` — how event delivery to the app is going.

With saved keys the bridge connects by itself at start-up and after any drop
(back-off to a minute). Without them it waits for `connect` instead of
generating QR codes forever, and a QR nobody scans in time returns it to
`logged_out`.

### Groups

| Route | Body | Returns |
| --- | --- | --- |
| `GET /v1/groups` | — | `{ groups: Group[] }`, every group the number is in, newest first |
| `GET /v1/groups/:jid` | — | `{ group: Group }` |
| `POST /v1/groups` | `{ subject (≤100), participants?: E164[] (≤50), description?, projectId? }` | `201 { group, inviteLink \| null }` |
| `GET /v1/groups/:jid/invite` | — | `{ inviteLink }` (`https://chat.whatsapp.com/…`) |
| `POST /v1/groups/:jid/participants` | `{ action: "add" \| "remove", participants: E164[] }` | `{ results: [{ jid, phoneE164, status }] }` |
| `POST /v1/groups/:jid/messages` | `{ text (≤4096) }` + header `Idempotency-Key` | `{ messageId, sentAt, replayed }` |

`Group` is `{ jid, subject, description, createdAt, participants: [{ jid,
phoneE164, admin }], isAdmin, announce, projectId }` — `projectId` is the
bridge's mapping, `isAdmin` whether Royal's number is an admin.

A participant's `jid` is WhatsApp's id for them: `…@s.whatsapp.net` (a phone
number) or `…@lid` (a private id). `phoneE164` is set only when WhatsApp shared
the number; a `@lid`'s digits are never a phone number.

**Sending once.** `Idempotency-Key` is required. The bridge chooses the
WhatsApp message id before sending, remembers each successful key for seven
days, and answers a repeat with the first send's id and `replayed: true`
instead of posting again. The app uses its outbox key
(`project-whatsapp:<projectId>:<composer key>`) as the `Idempotency-Key`. An
unconfirmed send is not remembered — the app holds it for *Mark sent / Mark not
sent* and never retries it by itself.

**Creating.** Owners' numbers go in `participants`; WhatsApp refuses anyone
whose privacy settings forbid being added (their `status` in the result is not
`200`), and they join with the invite link the office emails. With `projectId`
the group is mapped before the response, so no early message is missed.

### Mappings

| Route | Body | Returns |
| --- | --- | --- |
| `GET /v1/mappings` | — | `{ mappings: [{ groupJid, projectId, mappedAt }] }` |
| `PUT /v1/mappings` | `{ mappings: [{ groupJid, projectId }] }` | `{ added, changed, removed, mappings }` — replaces all |
| `PUT /v1/mappings/:jid` | `{ projectId }` | `{ mapping }` — a project's previous group is released |
| `DELETE /v1/mappings/:jid` | — | `{ removed }` |

A project has at most one group; `PUT /v1/mappings` refuses a list that names a
project twice.

### Media

`GET /v1/media/:messageId` returns the file's bytes with its `Content-Type`,
`Content-Length` and `X-Content-Sha256` (base64). The bridge downloads a mapped
group's media **when it arrives** (WhatsApp's links expire) and keeps it for
`MEDIA_RETENTION_DAYS` (default 14); after that, or if it was never downloaded,
`404 not_found`, which the app records as a permanent failure with the reason.

## 4. Events (bridge → app)

One event per POST, in this envelope:

```json
{
  "id": "msg:3EB0C8A1F2…",
  "type": "message.received",
  "occurredAt": "2026-11-21T01:00:00.000Z",
  "data": { }
}
```

`id` is stable for one fact (`msg:<messageId>`, `status:<messageId>:<status>`),
so a redelivery is recognisable; the app also deduplicates on WhatsApp's message
id.

| `type` | Sent when | `data` |
| --- | --- | --- |
| `message.received` | Someone (including Royal's own number, from the phone) posts in a **mapped** group | below |
| `message.status` | A message the app sent is sent / delivered / read / failed | `{ groupJid, messageId, status, at }` |
| `group.updated` | A mapped group's subject changes | `{ groupJid, projectId, subject }` |
| `group.participants` | People are added to / removed from / promoted in a mapped group | `{ groupJid, projectId, action, participants: [{ jid, phoneE164 }] }` |
| `session.updated` | The session opens, drops, or is logged out | `{ status, account, reason }` |

`message.received`:

```json
{
  "groupJid": "120363012345678901@g.us",
  "projectId": "6f1c…",
  "messageId": "3EB0C8A1F2…",
  "fromMe": false,
  "sender": { "jid": "123456789012345@lid", "phoneE164": "+61412345678", "name": "Ann" },
  "sentAt": "2026-11-21T00:59:58.000Z",
  "kind": "text",
  "text": "Is the slab poured?",
  "media": null,
  "unsupportedType": null
}
```

- `kind` is `text`, `media` or `unsupported` (a location, a contact, a poll…;
  `unsupportedType` names it and the app shows a placeholder).
- `media` is `{ kind: image|video|audio|document|sticker, mimeType, fileName,
  caption, voice, byteSize, sha256, available, unavailableReason }`. With
  `available: true` the app fetches it from `GET /v1/media/:messageId`;
  otherwise it records the file as failed with `unavailableReason`.
- `fromMe: true` is Royal's own number writing on the phone. A message the
  bridge sent for the app is never echoed back.
- `projectId` is the bridge's mapping, a hint only: the app resolves the group
  by `groupJid` against its own links.

Reactions, edits, deletions, receipts and protocol traffic are not forwarded.

### What the app answers, and what the bridge does with it

| App answers | Means | The bridge |
| --- | --- | --- |
| `200` | Recorded, or deliberately ignored (`unknown_group`, an unknown `type`) | deletes the event |
| `400` | Will never be acceptable (does not parse) | moves it to `DATA_DIR/outbox-dead/` and logs an error |
| `401` | Signature or secret problem — fixable | keeps it, retries with back-off |
| `408`, `429`, `5xx`, no answer | Try again | keeps it, retries with back-off (2 s doubling to 5 min) |

Events are written to `DATA_DIR/outbox/` **before** anything is sent and
delivered in order; a failure stops the queue until it clears, so nothing
overtakes a message waiting for the app. Admin › WhatsApp bridge shows the
queue (`outbox` on `GET /v1/session`).

`session.updated` with `status: "logged_out"` is logged by the app at error
level, which Sentry turns into an email to the office: it is the only way anyone
learns that group messages stopped.

## 5. Flows

**Linking the number (once, and after any logout).** Admin › WhatsApp bridge
→ *Show login QR code* (`POST /v1/session/connect`, then polling
`/v1/session/qr`) → on the phone with Royal's WhatsApp: Settings › Linked
devices › Link a device → scan. The page turns *Connected*.

**A new group.** Project › WhatsApp → *Create group* → the app writes a
`CREATING` row and an outbox intent, calls `POST /v1/groups` with the owners'
mobiles and `projectId`, and on success stores the group id, invite link and
members as `ACTIVE`. A refusal marks it `FAILED` with the bridge's sentence
(*Create* again is a fresh attempt). An unconfirmed create is **not** repeated:
it is marked `FAILED` and the office is told to look for the group on Admin ›
WhatsApp bridge and link it.

**An existing group** (made on the phone, or before the bridge). Make sure
Royal's number is in it (and an admin, for the invite link), then Project ›
WhatsApp › *Link existing group*, or Admin › WhatsApp bridge › *Link to
project*. Messages from before the link are not imported.

**The wrong group.** *Unlink* (project header, or the admin page) → the
project keeps its history, the group is untouched in WhatsApp, the bridge stops
forwarding it; link the right one.

## 6. Configuration

| App (Vercel) | Bridge (`services/whatsapp-bridge/.env`) |
| --- | --- |
| `WHATSAPP_BRIDGE_URL` — the bridge's https base URL | `APP_WEBHOOK_URL` — `https://<app>/api/whatsapp-bridge/webhook` |
| `WHATSAPP_BRIDGE_API_TOKEN` | `BRIDGE_API_TOKEN` (same value) |
| `WHATSAPP_BRIDGE_WEBHOOK_SECRET` | `BRIDGE_WEBHOOK_SECRET` (same value) |
| | `DATA_DIR` (`/data`, a volume), `MEDIA_RETENTION_DAYS`, `MEDIA_MAX_BYTES`, `LOG_LEVEL` |

Staging and production each need their **own bridge and their own WhatsApp
number**: a number can be linked to one bridge, and one bridge posts to one app.

## 7. Risks worth knowing

- Baileys is an unofficial client of WhatsApp's own protocol. WhatsApp can ban
  a number that behaves like a bot — bulk messaging, many new groups, messaging
  strangers. Royal's use (a handful of groups with its own clients) is the
  ordinary kind, but keep it that way: no broadcast features, no automated
  messages to people who have not joined.
- The linked device's keys live in `DATA_DIR/auth`. Anyone with that folder can
  read and send as Royal's number: back it up as a secret, never commit it, and
  *Disconnect* (or Linked devices › Log out on the phone) if the server is
  compromised.
- WhatsApp unlinks a companion device that has not been online for about
  14 days. Keep the bridge running; the admin page and the `session.updated`
  error say when it needs a scan.
