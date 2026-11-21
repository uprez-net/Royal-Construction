# Royal WhatsApp bridge

One WhatsApp session — Royal's number, linked by QR code like WhatsApp Web —
behind a small token-authenticated HTTP API, so the Royal app can create
project groups, post in them, and receive what the owners post. Built on
[Baileys](https://baileys.wiki/introduction) 7.

**The contract with the app (routes, events, signing, error codes) is
[`docs/whatsapp-bridge.md`](../../docs/whatsapp-bridge.md).** This page is
about running the service.

This folder is a standalone package: its own `package.json`, lockfile,
TypeScript config, tests, Prettier config, Dockerfile and compose file. The
Next.js app's typecheck, lint, tests and build never look in here, and this
service imports nothing from the app.

```
src/
  index.ts            start-up and shutdown
  config.ts           environment (refuses to start without a strong token)
  http/app.ts         the API (Hono); http/auth.ts the bearer check
  whatsapp/session.ts the Baileys socket: QR, reconnects, groups, sending, events
  whatsapp/normalise.ts  WhatsApp message → text / media / unsupported
  events/outbox.ts    durable, signed, in-order delivery to the app
  store/              mappings, sent-message keys, downloaded media (JSON files)
tests/                Vitest, with a fake WhatsApp client
scripts/ci-changes.mjs  skips CI for formatting-only changes
```

## Running it locally

Node 22+ and pnpm 9.

```sh
cd services/whatsapp-bridge
pnpm install
cp .env.example .env      # set BRIDGE_API_TOKEN (openssl rand -hex 32)
pnpm dev                  # builds, then serves on :8080 with ./data
```

Point the app at it with `WHATSAPP_BRIDGE_URL=http://localhost:8080` and the same
token as `WHATSAPP_BRIDGE_API_TOKEN`, then open Admin › WhatsApp bridge and
scan the QR with a **test** WhatsApp number. For events to reach a local app,
set `APP_WEBHOOK_URL=http://localhost:3000/api/whatsapp-bridge/webhook` and
`BRIDGE_WEBHOOK_SECRET` (same value as the app's
`WHATSAPP_BRIDGE_WEBHOOK_SECRET`).

| Command | Does |
| --- | --- |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `pnpm format:check` | Prettier, with this folder's config |
| `pnpm build` / `pnpm start` | compile to `dist/`, run it |

## Tokens

Two secrets, each generated once per deployment with `openssl rand -hex 32` and
set on **both** sides:

| Bridge (`.env`) | App (Vercel env) | Direction |
| --- | --- | --- |
| `BRIDGE_API_TOKEN` | `WHATSAPP_BRIDGE_API_TOKEN` | app → bridge, `Authorization: Bearer` |
| `BRIDGE_WEBHOOK_SECRET` | `WHATSAPP_BRIDGE_WEBHOOK_SECRET` | bridge → app, HMAC signature |

To rotate one: set the new value on the bridge and restart it, then on the app
and redeploy. Events the app refuses in between (401) wait on the bridge and
are delivered once both agree; app calls fail with a clear "token doesn't
match" until then.

## Deploying

Any Linux server with Docker. The bridge must be reachable by the app over
HTTPS; `compose.yaml` can run Caddy in front with an automatic certificate.

### First time, on the server

```sh
sudo mkdir -p /opt/royal-whatsapp-bridge && cd /opt/royal-whatsapp-bridge
# copy compose.yaml, Caddyfile and .env.example here (CI copies the first two
# on every deploy), then:
cp .env.example .env && nano .env     # tokens, APP_WEBHOOK_URL, BRIDGE_DOMAIN
docker compose --profile tls up -d    # or without the profile behind your own proxy
```

Point `BRIDGE_DOMAIN`'s DNS at the server and open ports 80 and 443. Then set
the app's `WHATSAPP_BRIDGE_URL=https://<BRIDGE_DOMAIN>` and the two tokens, and
scan the QR on Admin › WhatsApp bridge.

Everything that must survive a redeploy is in the `bridge-data` volume
(`/data`): the linked device's keys (`auth/`), `mappings.json`, the event
outbox, sent-message keys and media. **Back up `auth/` like a password** —
whoever has it can act as Royal's number.

### From CI

`.github/workflows/whatsapp-bridge.yml` runs only when this folder (or the
workflow) changes, and skips a change that is only formatting or docs. On a
push to `staging` or `main` that passes, it builds
`ghcr.io/uprez-net/royal-construction-whatsapp-bridge:sha-<commit>`, copies
`compose.yaml` and `Caddyfile` to the server, and runs
`docker compose pull && up -d`, then waits for `/healthz`.

Configure each GitHub environment (`whatsapp-bridge-staging`,
`whatsapp-bridge-production`):

| Secret / variable | Value |
| --- | --- |
| `BRIDGE_SSH_HOST` (secret) | the server |
| `BRIDGE_SSH_USER` (secret) | a user in the `docker` group |
| `BRIDGE_SSH_KEY` (secret) | its private key |
| `BRIDGE_SSH_KNOWN_HOSTS` (secret) | `ssh-keyscan <host>` output |
| `BRIDGE_DEPLOY_PATH` (variable, optional) | defaults to `/opt/royal-whatsapp-bridge` |
| `BRIDGE_COMPOSE_PROFILES` (variable, optional) | `tls` to run Caddy |

Until those are set the deploy job publishes the image and stops with a notice
instead of failing. The server's `.env` is never sent by CI.

Staging and production need **separate servers and separate WhatsApp
numbers**.

## Operating it

- **Admin › WhatsApp bridge** in the app is the control panel: status, the QR,
  *Disconnect*, the groups and their projects, and the event queue.
- `docker compose logs -f whatsapp-bridge` — JSON logs (pino) with ids and
  states, never message text or phone numbers.
- **Logged out?** Scan a new QR on the admin page. Nothing queued is lost.
- **Events stuck?** The admin page shows the last delivery error. `outbox-dead/`
  holds events the app refused with a 400 (a contract mismatch — check both
  sides are on the same version); they are not retried.
- **Restart**: `docker compose restart whatsapp-bridge`. It reconnects with the
  saved keys.
