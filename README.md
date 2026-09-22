# Royal Constructions

Construction management portal for coordinating projects, tradies, site updates, and customer workflows. Built with Next.js App Router, Clerk authentication, Prisma on PostgreSQL, and a hybrid server/client architecture.

## Features

**Live (data-backed)**

- **Dashboard** — signed-in home with project overview
- **Projects** — list, detail, milestones, variations, site updates, and file uploads
- **Tradies** — coordination dashboards, scheduling, and reminder automation
- **Auth** — Clerk sign-in, sign-up, profile, and webhook sync to local user records
- **Uploads** — direct-to-Vercel Blob uploads with database persistence
- **Leads** — Microsoft Graph integration for inbound lead capture and email workflows

**In progress (mock or partial)**

Several module routes (financials, quotations, milestones, catalogue, architect, government, site manager) are still driven by the legacy screen registry in `lib/mock-data.tsx` and are being migrated to live data. The feature-flagged `/agent` workspace is the current operations assistant surface.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router, React 19, React Compiler) |
| Auth | [Clerk](https://clerk.com) |
| Database | [PostgreSQL](https://www.postgresql.org) via [Prisma 7](https://www.prisma.io) |
| Client state | [Redux Toolkit](https://redux-toolkit.js.org) |
| UI | [Tailwind CSS 4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com) |
| Storage | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) |
| Email / leads | Microsoft Graph, [Resend](https://resend.com), [React Email](https://react.email) |
| AI | [Vercel AI SDK](https://sdk.vercel.ai) + Google Gemini (lead extraction) |
| Tests | [Vitest](https://vitest.dev) with `node:assert/strict` |

## Prerequisites

- Node.js 24+ (required by the Eve agent runtime)
- [pnpm](https://pnpm.io) 9 (see `packageManager` in `package.json`)
- PostgreSQL database (local or hosted, e.g. [Neon](https://neon.tech))
- [Clerk](https://dashboard.clerk.com) application

## Getting started

1. **Clone and install**

   ```bash
   git clone <repo-url>
   cd Royal-Construction
   pnpm install
   ```

2. **Configure environment**

   Create `.env.local` in the project root:

   ```bash
   # Required
   DATABASE_URL="postgresql://..."
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_..."
   CLERK_SECRET_KEY="sk_..."
   NEXT_PUBLIC_APP_URL="http://localhost:3000"

   # Vercel Blob (uploads)
   BLOB_READ_WRITE_TOKEN="..."

   # Cron jobs (production)
   CRON_SECRET="..."

   # Signs the workflow stream links handed to the browser (any long random
   # string; set it in Vercel Preview and Production). Without it, project and
   # checklist extraction refuse to start.
   WORKFLOW_RUN_CAPABILITY_SECRET="..."

   # Eve operations agent (fail-closed unless explicitly enabled)
   AI_GATEWAY_API_KEY="..."
   EVE_OPERATIONS_AGENT_ENABLED="false"
   EVE_OPERATIONS_SPECIALISTS_ENABLED="false"

   # Optional agent working-memory cache. Postgres remains authoritative.
   UPSTASH_REDIS_REST_URL="https://...upstash.io"
   UPSTASH_REDIS_REST_TOKEN="..."

   # Local dev auto sign-in (optional — skips manual Clerk login)
   DEV_AUTO_SIGN_IN="true"
   DEV_AUTH_EMAIL="you@example.com"
   DEV_AUTH_CLERK_USER_ID="user_..."
   ```

   Optional integrations:

   | Variable | Purpose |
   | --- | --- |
   | `GOOGLE_MAPS_API_KEY`, `GEOSCAPE_API_KEY` | Address lookup |
   | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Microsoft Graph |
   | `GRAPH_MODE`, `GRAPH_SENDER_UPN`, `BUSINESS_EMAIL` | Business Graph email / leadgen |
   | `GRAPH_ADMIN_SENDER_UPN`, `BUSINESS_ADMIN_EMAIL`, `GRAPH_ADMIN_MAIL_CC` | Compliance Graph mailbox |
   | `GRAPH_ADMIN_WEBHOOK_CLIENT_STATE`, `GRAPH_ADMIN_SUBSCRIPTION_RESOURCE` | Admin Graph webhook (client state must be unique) |
   | `GEMINI_API_KEY` | AI lead extraction |
   | `AI_GATEWAY_API_KEY` | Vercel AI Gateway access for the Eve operations agent |
   | `EVE_OPERATIONS_AGENT_ENABLED` | Enables the authenticated Eve channel; defaults to disabled |
   | `EVE_OPERATIONS_SPECIALISTS_ENABLED` | Exposes the declared specialist shells; keep disabled until their authorized tools pass evals |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional disposable cache/coordination layer for agent memory; Postgres remains authoritative |
   | `TWILIO_*` | Outbound IVR (see `docs/twillo-outbound-ivr.md`) |

3. **Set up the database**

   ```bash
   pnpm prisma:generate
   npx prisma migrate deploy   # or: npx prisma migrate dev
   pnpm prisma:seed            # optional sample data
   ```

4. **Run the dev server**

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

   In development, unauthenticated page navigations redirect to `/api/dev/sign-in` for automatic Clerk sign-in (disable with `DEV_AUTO_SIGN_IN=false`).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm eve:build` | Compile the standalone Eve runtime (run before a local production Next.js build) |
| `pnpm eve:eval` | Run strict Eve evals and emit JUnit output under `.eve/` |
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm dev:webpack` | Start dev server with Webpack |
| `pnpm build` | Compile Eve, then create the production Next.js build |
| `pnpm start` | Run production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Whole suite (both Vitest projects, including the Chromium print lane) |
| `pnpm test:unit` | What CI runs — everything except the two Chromium tests |
| `pnpm test:print` | The two Chromium print tests; needs a local Chrome |
| `pnpm test:offer` / `pnpm test:graph` | One directory |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:seed` | Seed database |
| `pnpm seed:projects` | Seed projects only |

## Tests

[Vitest](https://vitest.dev) runs the suite in a Node environment — the tests
are domain, contract and source-shape checks, not browser tests, so there is no
jsdom and no React Testing Library. Assertions are `node:assert/strict`, which
is what they were written against; only the runner changed (issue #326).

```bash
pnpm test:watch          # re-runs the files a change touches
pnpm test:watch tests/offer/pricing.test.ts
pnpm test:unit           # one full CI-equivalent run
```

`vitest run` is the explicit non-watch mode every script above uses, so CI and
a terminal behave the same way.

The suite is split into two Vitest projects, declared in `vitest.config.mts`:

| Project | Files | Run by |
| --- | --- | --- |
| `unit` | `tests/**/*.test.ts` except the two below | `pnpm test:unit` — this is the CI lane |
| `print` | `offer-document-print-pages`, `offer-tender-print-parity` | `pnpm test:print` |

The `print` project drives a real Chromium through Puppeteer to prove the
emailed PDF and the browser print view paginate identically. CI sets
`PUPPETEER_SKIP_DOWNLOAD` and installs no browser, so those two files are not
in the CI lane — but they **fail loudly** rather than skipping when Chromium is
missing, because a print test that quietly skips is how a "footer says 10,
prints 11" bug reaches a client. Run `pnpm test:print` before shipping a change
to the offer documents.

Conventions:

- Tests import application code through the `@/` alias (`@/lib/offer/pricing`),
  and each other relatively (`./tender-fixtures`). A relative specifier in a
  test therefore means "a sibling fixture"; `@/` means "the code under test".
- A file that reads repository source rather than importing it takes its root
  from `tests/support/repo-root.ts`, never `__dirname` or `process.cwd()`.
- Each test file runs in its own process, and tests within a file run in order.
  Files that mutate `process.env` still restore it in `afterEach`; isolation is
  a second line of defence, not a reason to drop the cleanup.

## Project structure

```
app/              Next.js routes, layouts, and API handlers
components/       UI — common shell, feature screens, shadcn primitives
lib/              Server data helpers, Redux store, auth, integrations
prisma/           Schema, migrations, and seed scripts
hooks/            Client-side React hooks
types/            Shared TypeScript types
utils/            Pure helpers and validators
docs/             Architecture and implementation notes
proxy.ts          Clerk middleware (route protection, dev auto sign-in)
```

Key routes:

| Path | Description |
| --- | --- |
| `/` | Dashboard |
| `/projects`, `/projects/[id]` | Project list and detail |
| `/tradie` | Tradie coordination |
| `/leads` | Lead management |
| `/sign-in`, `/sign-up` | Clerk auth |

## Documentation

Internal docs live in `docs/`:

- [`docs/architecture.md`](docs/architecture.md) — system design, data flow, and caching
- [`docs/implementation.md`](docs/implementation.md) — live vs mock modules, API patterns, workflows
- [`docs/folder-structure.md`](docs/folder-structure.md) — where to put new code

## Deployment

The app is designed for [Vercel](https://vercel.com):

1. Link the repository and set environment variables.
2. Ensure `DATABASE_URL` points to a production PostgreSQL instance.
3. Configure Clerk webhook endpoint: `/api/webhook/clerk`.
4. Cron jobs are defined in `vercel.json`:
   - `/api/cron/tradie-reminders` — daily at 08:00 UTC
   - `/api/cron/graph-renew` — daily at midnight UTC

Both cron routes require `CRON_SECRET` in production.

## License

Private — not for public distribution.

