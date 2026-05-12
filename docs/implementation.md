# Current Implementation

This document describes the live implementation in the repository today. It focuses on the concrete routing model, Prisma schema changes, seed data, API routes, and the data access layers that power the new project and tradie experiences.

## Product Shape

The application is a construction management portal built on Next.js App Router, Clerk authentication, and Prisma/PostgreSQL persistence. The product still uses a shared app shell and a route-driven screen registry, but the important operational modules now read from live database-backed queries rather than static mock arrays.

At a high level, the app already supports:

- authenticated access control through Clerk middleware
- sign-in and sign-up flows
- a dashboard shell with navigation, breadcrumbs, actions, and notifications UI
- multiple business screens rendered from a single screen registry
- Clerk webhook synchronization into Prisma records
- file uploads through Vercel Blob with post-upload database persistence
- live project, milestone, update, variation, tradie schedule, and activity log data

## Routing And Entry Points

### Home route

The home route in [app/page.tsx](../app/page.tsx) loads the dashboard experience directly. It checks the Clerk session server-side and passes the signed-in state into the dashboard component.

### Dynamic screen route

The dynamic route in [app/[screen]/page.tsx](../app/%5Bscreen%5D/page.tsx) is the main screen dispatcher. It reads the screen segment from the URL, looks up the matching renderer in `screenRegistry`, and wraps the result in the shared AppShell.

The registry still powers the legacy screen routing shape, but the project and tradie entries now resolve to live server components backed by Prisma query helpers instead of static mock renderers.

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

The screen system is defined in [lib/mock-data.tsx](../lib/mock-data.tsx). Each slug maps to a renderer function, which is how the app currently delivers the module surfaces.

### Dashboard

The dashboard implementation shows:

- KPI cards for active projects, pending quotes, open leads, and revenue forecast
- a project section using reusable project cards
- a live activity feed for operational updates

The dashboard experience is implemented in [components/dashboard/dashboard-home.tsx](../components/dashboard/dashboard-home.tsx) and is also reused through the screen registry.

### Projects

The projects module now uses the live data layer in [lib/data/projects.ts](../lib/data/projects.ts). That module exposes:

- getProjects() for the project index and server-filtered project screen
- getProjectById() for the dynamic detail route and the registry-backed project detail surface
- getProjectKPIs() for the dashboard-style summary cards

The list query returns the customer, optional site manager, milestone completion counts, and a computed progress percentage. The detail query expands into milestone timelines, site updates, variations, tradie schedules, and project files so the detail screen can render everything from one server-side fetch.

### Leads

The leads screen is currently implemented as a stage-based board with counts and card stacks for each pipeline stage.

### Quotations

The quotations screen uses the shared data table component to present quote rows, status, and expiry information.

### Quote details

The quote-details screen already has a structured detail layout with quote metadata, a status pill, a right-side action panel, and approval-related buttons.

### Catalogue

The catalogue screen is a category grid for material groups such as roofing, joinery, bathroom, and outdoor products.

### Milestones

The milestones screen uses a vertical timeline pattern to show stages and their status, including done, current, and pending markers.

### Trade- and role-specific screens

The following screens are implemented as reusable simple list surfaces backed by the same card and status primitives:

- architect
- government
- sitemanager

The tradie module is now live and backed by [lib/data/tradies.ts](../lib/data/tradies.ts). That module exposes:

- getTradies() for the tradie directory and schedule modals
- getTradieSchedules() for the schedule table, urgent reminders, and filters
- getTradieScheduleKPIs() for the reminder dashboard cards

The schedule query supports project, status, trade-type, sort, and order filters, and returns the tradie, project, and milestone relations needed by the UI without extra client fetches.

### Financials

The financials screen combines KPI cards with a project P&L table. It is already structured for revenue, cost, margin, and status tracking.

### Chatbot

The chatbot screen is laid out as a three-column conversation workspace with customer list, conversation thread, and settings pane.

### Project detail

The project-detail experience now comes from live data in [components/projects/project-detail-screen.tsx](../components/projects/project-detail-screen.tsx) and the dynamic route in [app/project-detail/[id]/page.tsx](../app/project-detail/%5Bid%5D/page.tsx). It is no longer a stub summary card.

The live view includes:

- project metadata and budget usage
- customer and site manager details
- milestone status and timeline tracking
- site updates with attached photos
- variation records with approval and delay information
- action modals for posting site updates and creating variations

## Reusable UI Building Blocks

The app is built from composable UI primitives in components/common, components/project, components/projects, and components/ui.

The most important reusable pieces already in place are:

- [components/common/metric-card.tsx](../components/common/metric-card.tsx) for KPI summaries
- [components/common/section-card.tsx](../components/common/section-card.tsx) for consistent surface containers
- [components/common/data-table.tsx](../components/common/data-table.tsx) for tabular views
- [components/common/status-pill.tsx](../components/common/status-pill.tsx) for status labels
- [components/project/project-card.tsx](../components/project/project-card.tsx) for project previews
- [components/projects/project-detail-screen.tsx](../components/projects/project-detail-screen.tsx) for the live project detail view
- [components/tradies/tradies-screen.tsx](../components/tradies/tradies-screen.tsx) for the tradie coordination view

The shared UI library under [components/ui](../components/ui) is already populated with standard primitives such as buttons, inputs, dialogs, tables, tabs, sheets, and more.

## Authentication And Access Control

### Middleware protection

The middleware in [proxy.ts](../proxy.ts) protects all non-public routes through Clerk. Public routes currently include sign-in, sign-up, and the Clerk webhook endpoint.

### Clerk server usage

Server-side auth checks use auth() from Clerk in the main dashboard route, the screen dispatcher, and every authenticated API route. That means the current implementation already knows whether a user is signed in when rendering views or mutating records.

### User metadata synchronization

The Clerk client wrapper in [lib/auth.ts](../lib/auth.ts) updates public and private metadata after user lifecycle events. This is used to keep Clerk and the internal app record aligned.

## Webhooks

The Clerk webhook handler in [app/api/webhook/clerk/route.ts](../app/api/webhook/clerk/route.ts) is already implemented for several event types:

- user.created creates a local Prisma user and, for customers, a matching customer record
- user.updated keeps the Prisma user record in sync with Clerk profile changes
- user.deleted removes the local user record
- organizationInvitation.accepted updates the role and organization metadata
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

The Prisma schema in [prisma/schema.prisma](../prisma/schema.prisma) already defines the core domain model, but it has been expanded substantially to support live operational workflows.

### User and customer identity

- User stores the local application identity, Clerk ID, role, contact details, and optional customer link
- Customer stores customer profile data and links back to User
- Role currently supports ADMIN, CUSTOMER, and SITE_MANAGER

### Project structure

- Project belongs to a customer, may be assigned to a site manager, and carries budget, schedule, location, status, and requirement data
- Milestone belongs to a project and tracks ordering, target and actual dates, completion state, and photo requirements
- SiteUpdate, Variation, TradieSchedule, and ActivityLog now capture the operational workflow around each project
- Tradie stores trade type, company, contact details, optional rate and rating, plus project and milestone relationships
- File attaches uploaded documents to projects, optional milestones, and the uploading user

### Why the schema changed

The expanded schema supports the live workbench that the new UI needs. The original mock screens only needed labels and statuses, but the live project and tradie flows need more context:

- project-level budgeting and delivery timing
- milestone-level target dates and completion state
- uploaded site photos and progress notes
- change-order approval and schedule delay tracking
- tradie scheduling and reminder automation

That is why the new models are centered around operational workflow rather than display fields alone.

### Schema behavior already in place

The schema includes:

- UUID primary keys
- timestamps on all major models
- indexes for common lookup fields
- uniqueness constraints for email, phone, Clerk ID, and composite milestone ordering
- cascade behavior on file and customer relations where appropriate

## Seed Script

The seed script in [prisma/seed.ts](../prisma/seed.ts) now builds a realistic construction dataset that matches the expanded schema.

It does the following:

- initializes Prisma Client with the PostgreSQL adapter required by the current Prisma setup
- clears the database in dependency order before inserting new records
- creates one admin user, six site managers, five customers, and six tradies
- inserts five end-to-end projects with customer assignments, site managers, budgets, statuses, and dates
- creates project milestones, site updates, variations, tradie schedules, and activity logs for those projects
- writes JSON requirement data and date-based operational history so the live screens have meaningful content immediately after seeding

The seed data is intentionally connected across relations. Project milestones are created first so later site updates and tradie schedules can link to them, and customer users are created before customer records so the user/customer relationship stays valid.

The seed config in [prisma.config.ts](../prisma.config.ts) points Prisma at the TypeScript seed entry, and the package scripts include the dependencies required to execute it in this workspace.

## API Surface

The live APIs are authenticated and built around the new data layer. They are shaped to support the current screens rather than being generic CRUD endpoints.

### Project routes

- [app/api/projects/route.ts](../app/api/projects/route.ts) returns the project list and supports a status filter from the query string
- [app/api/projects/[projectId]/route.ts](../app/api/projects/%5BprojectId%5D/route.ts) returns a single project with the full detail payload
- [app/api/projects/[projectId]/milestones/route.ts](../app/api/projects/%5BprojectId%5D/milestones/route.ts) returns milestone options for scheduling and update modals
- [app/api/projects/[projectId]/updates/route.ts](../app/api/projects/%5BprojectId%5D/updates/route.ts) posts site updates, uploads attached photos to Blob, records the update in Prisma, and marks photo-required milestones complete
- [app/api/projects/[projectId]/variations/route.ts](../app/api/projects/%5BprojectId%5D/variations/route.ts) creates variation requests
- [app/api/projects/[projectId]/variations/[variationId]/route.ts](../app/api/projects/%5BprojectId%5D/variations/%5BvariationId%5D/route.ts) updates variation status and applies the delay logic when approved

### Tradie routes

- [app/api/tradies/route.ts](../app/api/tradies/route.ts) returns the tradie directory
- [app/api/tradie-schedules/route.ts](../app/api/tradie-schedules/route.ts) creates new tradie schedule records
- [app/api/tradie-schedules/[scheduleId]/route.ts](../app/api/tradie-schedules/%5BscheduleId%5D/route.ts) updates schedule status and flags whether a replacement may be required

### Upload and cron routes

- [app/api/upload/route.ts](../app/api/upload/route.ts) generates Blob upload tokens, enforces authentication, and persists uploaded files after completion
- [app/api/cron/tradie-reminders/route.ts](../app/api/cron/tradie-reminders/route.ts) runs the reminder job and requires the cron secret bearer token

All of these routes check Clerk auth before serving data or mutating records, except for the cron route, which uses the configured secret instead.

## Background Jobs And Business Logic

The live data layer is supported by two helper modules that implement business logic instead of just query logic.

### Variation delay helper

[lib/utils/apply-variation-delay.ts](../lib/utils/apply-variation-delay.ts) applies a delay after a variation is approved. It:

- loads the variation and its parent project milestones
- requires the variation to be approved before it can run
- calculates the day delta between the requested and approved dates
- updates later pending milestones by shifting their target dates
- extends the project estimated end date in the same transaction

This is what makes the variation approval route more than a status update; it affects the project schedule.

### Tradie reminder job

[lib/jobs/tradie-reminder.ts](../lib/jobs/tradie-reminder.ts) sends reminder state for schedules due seven days out. It:

- finds schedules in the target date window
- skips schedules that already have a reminder timestamp
- marks pending schedules as pending response
- writes reminder timestamps back to the database
- records reminder activity in the logs through console output and the cron route response

The deployment hook for that job is [vercel.json](../vercel.json), which schedules the cron endpoint daily at 8:00 AM.

## Data Flow Summary

The implementation already follows a coherent flow:

1. Clerk authenticates the user.
2. The middleware protects the app except for auth and webhook endpoints.
3. The dashboard or screen registry renders the requested surface inside the shared shell.
4. Server components call the Prisma data helpers in [lib/data/projects.ts](../lib/data/projects.ts) and [lib/data/tradies.ts](../lib/data/tradies.ts) to fetch live projects, KPIs, and schedules.
5. Mutation routes handle updates, variations, schedules, and uploads with the same authenticated user context.
6. Clerk webhooks synchronize identity changes into Prisma.
7. Blob uploads are authorized server-side and persisted into the file table after completion.
8. The cron route runs tradie reminders on a daily schedule.

This makes the current app more than a static mockup set: the UI is still registry-driven, but the identity, persistence, query, and file-handling paths are already wired for production-style integration.

## Current Implementation Notes

- The legacy registry still exists in [lib/mock-data.tsx](../lib/mock-data.tsx), but the projects and tradie entries now point at live server components.
- The shell, auth, webhook, upload, API, and cron flows are real and already connected.
- The app is organized so that each screen can later be replaced with live database-backed data without changing the overall routing model.
