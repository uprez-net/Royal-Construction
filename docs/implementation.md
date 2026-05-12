# Current Implementation

This document explains what is already implemented in the codebase today, based on the actual routes, components, API handlers, and database schema in the repository.

## Product Shape

The application is a construction management portal built on Next.js App Router, Clerk authentication, and Prisma/PostgreSQL persistence. The current implementation is centered on a shared app shell and a route-driven screen registry rather than a large number of separate page implementations.

At a high level, the app already supports:

- authenticated access control through Clerk middleware
- sign-in and sign-up flows
- a dashboard shell with navigation, breadcrumbs, actions, and notifications UI
- multiple business screens rendered from a single screen registry
- Clerk webhook synchronization into Prisma records
- file uploads through Vercel Blob with post-upload database persistence
- a relational data model for users, customers, projects, milestones, tradies, and files

## Routing And Entry Points

### Home route

The home route in [app/page.tsx](../app/page.tsx) loads the dashboard experience directly. It checks the Clerk session server-side and passes the signed-in state into the dashboard component.

### Dynamic screen route

The dynamic route in [app/[screen]/page.tsx](../app/%5Bscreen%5D/page.tsx) is the main screen dispatcher. It reads the `screen` segment from the URL, looks up the matching renderer in `screenRegistry`, and wraps the result in the shared `AppShell`.

This is the key implementation detail of the current UI: the product is not split into many independently wired pages. Instead, the visible modules are mapped from a central registry in [lib/mock-data.tsx](../lib/mock-data.tsx).

### Authentication pages

The workspace already includes Clerk auth pages for sign-in and sign-up under:

- [app/sign-in/[[...sign-in]]/page.tsx](../app/sign-in/%5B%5B...sign-in%5D%5D/page.tsx)
- [app/sign-up/[[...sign-up]]/page.tsx](../app/sign-up/%5B%5B...sign-up%5D%5D/page.tsx)

There is also a [user profile page](../app/user-profile/page.tsx) for account-related flows.

## Shared Layout And Shell

### Root layout

The global layout in [app/layout.tsx](../app/layout.tsx) sets the application metadata, registers Clerk, and loads three Google fonts:

- Manrope for body text
- Fraunces for headings
- IBM Plex Mono for mono accents

The layout also defines the app metadata, including the BuildPro title and a construction-management description.

### App shell

The main chrome lives in [components/common/app-shell.tsx](../components/common/app-shell.tsx). It provides:

- a left-hand navigation rail
- top-level breadcrumbs
- an action area for screen-specific controls
- a live clock in the header
- a notification toggle
- Clerk-aware sign-in, sign-up, and user menu controls

The shell also adds the visual treatment for the current product theme, including layered gradients and grid texture in the background.

## Screen Registry And Implemented Modules

The screen system is defined in [lib/mock-data.tsx](../lib/mock-data.tsx). Each slug maps to a renderer function, which is how the app currently delivers all of the module surfaces.

### Dashboard

The dashboard implementation shows:

- KPI cards for active projects, pending quotes, open leads, and revenue forecast
- a project section using reusable project cards
- a live activity feed for operational updates

The dashboard experience is implemented in [components/dashboard/dashboard-home.tsx](../components/dashboard/dashboard-home.tsx) and is also reused through the screen registry.

### Projects

The projects screen reuses the same project card model as the dashboard, which keeps list and summary views consistent.

### Leads

The leads screen is currently implemented as a stage-based board with counts and card stacks for each pipeline stage.

### Quotations

The quotations screen uses the shared data table component to present quote rows, status, and expiry information.

### Quote details

The quote-details screen already has a structured detail layout with:

- quote metadata
- a status pill
- a right-side action panel
- approval-related buttons

### Catalogue

The catalogue screen is a category grid for material groups such as roofing, joinery, bathroom, and outdoor products.

### Milestones

The milestones screen uses a vertical timeline pattern to show stages and their status, including done, current, and pending markers.

### Trade- and role-specific screens

The following screens are implemented as reusable simple list surfaces backed by the same card and status primitives:

- architect
- government
- tradie
- sitemanager

### Financials

The financials screen combines KPI cards with a project P&L table. It is already structured for revenue, cost, margin, and status tracking.

### Chatbot

The chatbot screen is laid out as a three-column conversation workspace with:

- customer list
- conversation thread
- settings pane

### Project detail

The project-detail screen is a detailed summary view with project attributes and action buttons for updates, variations, and client messaging.

## Reusable UI Building Blocks

The app is built from composable UI primitives in `components/common`, `components/project`, and `components/ui`.

The most important reusable pieces already in place are:

- [components/common/metric-card.tsx](../components/common/metric-card.tsx) for KPI summaries
- [components/common/section-card.tsx](../components/common/section-card.tsx) for consistent surface containers
- [components/common/data-table.tsx](../components/common/data-table.tsx) for tabular views
- [components/common/status-pill.tsx](../components/common/status-pill.tsx) for status labels
- [components/project/project-card.tsx](../components/project/project-card.tsx) for project previews

The shared UI library under [components/ui](../components/ui) is already populated with standard primitives such as buttons, inputs, dialogs, tables, tabs, sheets, and more.

## Authentication And Access Control

### Middleware protection

The middleware in [proxy.ts](../proxy.ts) protects all non-public routes through Clerk. Public routes currently include:

- sign-in
- sign-up
- the Clerk webhook endpoint

### Clerk server usage

Server-side auth checks use `auth()` from Clerk in the main dashboard route and the screen dispatcher. That means the current implementation already knows whether a user is signed in when rendering the shell and the dashboard.

### User metadata synchronization

The Clerk client wrapper in [lib/auth.ts](../lib/auth.ts) updates public and private metadata after user lifecycle events. This is used to keep Clerk and the internal app record aligned.

## Webhooks

The Clerk webhook handler in [app/api/webhook/clerk/route.ts](../app/api/webhook/clerk/route.ts) is already implemented for several event types:

- `user.created` creates a local Prisma user and, for customers, a matching customer record
- `user.updated` keeps the Prisma user record in sync with Clerk profile changes
- `user.deleted` removes the local user record
- `organizationInvitation.accepted` updates the role and organization metadata
- invitation created and revoked events are handled as acknowledged cases

This webhook is the current bridge between identity state and database state.

## File Upload Flow

The upload endpoint in [app/api/upload/route.ts](../app/api/upload/route.ts) is already wired to Vercel Blob.

The implementation currently does the following:

- requires an authenticated Clerk session before generating an upload token
- accepts a client payload containing the file name, project ID, and optional milestone ID
- allows common document and image types
- limits uploads to 40 MB
- attaches the authenticated user ID plus project and milestone metadata to the token payload
- saves the uploaded file record to Prisma after Blob reports completion

The database write for uploaded files is handled by [lib/data/file.ts](../lib/data/file.ts).

## Database Model

The Prisma schema in [prisma/schema.prisma](../prisma/schema.prisma) already defines the core domain model.

### User and customer identity

- `User` stores the local application identity, Clerk ID, role, contact details, and optional customer link
- `Customer` stores customer profile data and links back to `User`
- `Role` currently supports `ADMIN`, `CUSTOMER`, and `SITE_MANAGER`

### Project structure

- `Project` belongs to a customer
- `Milestone` belongs to a project and supports ordering, descriptions, and due dates
- `Tradie` can be linked to projects and milestones
- `File` attaches uploaded documents to projects, optional milestones, and the uploading user

### Schema behavior already in place

The schema includes:

- UUID primary keys
- timestamps on all major models
- indexes for common lookup fields
- uniqueness constraints for email, phone, Clerk ID, and composite milestone ordering
- cascade behavior on file and customer relations where appropriate

## Data Flow Summary

The implementation already follows a coherent flow:

1. Clerk authenticates the user.
2. The middleware protects the app except for auth and webhook endpoints.
3. The dashboard or screen registry renders the requested surface inside the shared shell.
4. Clerk webhooks synchronize identity changes into Prisma.
5. Blob uploads are authorized server-side and persisted into the file table after completion.

This makes the current app more than a static mockup set: the UI is still registry-driven, but the identity, persistence, and file-handling paths are already wired for production-style integration.

## Current Implementation Notes

- Most visible screens are still rendered from structured mock data in [lib/mock-data.tsx](../lib/mock-data.tsx).
- The shell, auth, webhook, and upload flows are real and already connected.
- The app is organized so that each screen can later be replaced with live database-backed data without changing the overall routing model.
