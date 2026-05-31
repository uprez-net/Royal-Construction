# Royal Construction

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

Several module routes (financials, quotations, milestones, catalogue, architect, government, site manager, chatbot) are still driven by the legacy screen registry in `lib/mock-data.tsx` and are being migrated to live data.

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

## Prerequisites

- Node.js 20+
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
   | `GRAPH_MODE`, `GRAPH_SENDER_UPN`, `BUSINESS_EMAIL` | Graph email / leadgen |
   | `GEMINI_API_KEY` | AI lead extraction |
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
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm dev:webpack` | Start dev server with Webpack |
| `pnpm build` | Production build |
| `pnpm start` | Run production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:seed` | Seed database |
| `pnpm seed:projects` | Seed projects only |

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

