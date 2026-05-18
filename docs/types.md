# Types

This document explains the type system used in the repository and how the domain models map to real-world entities.

## Type System Strategy

The repository separates types into three broad groups:

1. Prisma-backed domain models and DTOs
2. UI view models used by feature screens
3. Shared utility or integration types

That split is important because the frontend cannot safely consume Prisma types directly without serialization fixes.

## Domain Boundary: Prisma Models Versus Safe DTOs

The Prisma schema in [prisma/schema.prisma](../prisma/schema.prisma) uses database-native values such as decimals and DateTime fields.

The frontend-facing types in [types/project.ts](../types/project.ts) convert unsafe values into serializable equivalents.

### Serialization rule

- decimals become strings
- date-like values are transported as strings in API responses and client-facing DTOs
- nested relations are included only when the screen needs them

This is why the codebase defines types such as `SafeProject`, `SafeTradie`, and `SafeVariation`.

## Important Domain Entities

### Project

A project is the core construction contract record.

In the schema it represents:

- a customer-owned job
- an optional assigned site manager
- a budget, spend total, schedule window, and location
- a requirements JSON blob for feature-specific metadata

Important fields:

- `name`
- `description`
- `buildingType`
- `lotSize`
- `council`
- `customerId`
- `siteManagerId`
- `totalBudget`
- `spent`
- `startDate`
- `estimatedEndDate`
- `status`

### Milestone

A milestone is an ordered delivery stage within a project.

Important fields:

- `projectId`
- `name`
- `order`
- `targetDate`
- `actualDate`
- `status`
- `isPhotoRequired`

The lifecycle is simple:

- `PENDING`
- `ACTIVE`
- `DONE`

### Tradie

A tradie is a subcontractor or tradesperson that can be scheduled onto projects and milestones.

Important fields:

- `name`
- `company`
- `trade`
- `tradeType`
- `phone`
- `email`
- `hourlyRate`
- `rating`

### TradieSchedule

A tradie schedule connects a tradie to a project, and optionally a milestone, on a scheduled date.

Important fields:

- `tradieId`
- `projectId`
- `milestoneId`
- `scheduledDate`
- `durationDays`
- `status`
- `reminderSentAt`

The status lifecycle includes:

- `PENDING`
- `PENDING_RESPONSE`
- `CONFIRMED`
- `NO_RESPONSE`
- `DECLINED`
- `COMPLETED`

### Variation

A variation is a change-order record for scope, cost, or timing changes.

Important fields:

- `projectId`
- `description`
- `cost`
- `requestedDate`
- `approvedDate`
- `delayDays`
- `status`

The lifecycle is:

- `PENDING`
- `APPROVED`
- `REJECTED`

### SiteUpdate

A site update captures field progress notes and photos for a project.

Important fields:

- `projectId`
- `milestoneId`
- `authorId`
- `notes`
- `photoUrls`

### File

A file is an uploaded artifact attached to a project and optionally to a milestone.

Important fields:

- `projectId`
- `milestoneId`
- `filename`
- `url`
- `uploadedBy`

### Customer and User

The repository keeps customer identity and application identity separate.

- `User` stores the application identity, Clerk id, role, phone, email, and optional customer link
- `Customer` stores the customer-facing profile linked to the user row

This is why some flows create both a `User` and a `Customer` row together.

## Shared DTOs And View Models

| Type | Meaning |
| --- | --- |
| `ProjectWithStats` | Project list row enriched with milestone counts and progress |
| `ProjectDetail` | Full project payload used by detail screens and project mutations |
| `ProjectKPIs` | Dashboard counts for active, on-track, attention, and delayed projects |
| `TradieCoordinationDashboard` | Tradie dashboard payload with schedule rows, summary metrics, charts, and reminders |
| `TradieScheduleListItem` | Serializable schedule row used by the UI |
| `ProjectMutationState` | Pending/succeeded/failed state for project mutations |
| `ProjectUploadRecord` | Client-side upload progress model |

These are the important types to understand when working across server and client boundaries.

## Naming Conventions

The current codebase uses a few useful conventions:

- `Safe*` means Prisma data that has been converted for safe client or JSON use
- `*With*` means a relation-enriched model or a view-specific join shape
- `*ListItem` means a row-level DTO suitable for tables or cards
- `*Dashboard` means a larger composite payload with summary metrics plus collections
- `*Request` means a mutation input shape
- `*State` means Redux or UI state

These conventions are worth preserving because they make the direction of data obvious.

## Enum Conventions

Prisma enums are uppercase and database-oriented.

Examples:

- `Role`
- `ProjectStatus`
- `MilestoneStatus`
- `VariationStatus`
- `TradieScheduleStatus`

UI code usually converts those values into lowercase labels or user-friendly text. Do not expose raw enum names to the user unless the screen is explicitly operational.

## Nullable Handling Strategy

The repository uses both `null` and `undefined`, and the distinction matters.

- `null` usually means a field is intentionally empty or absent in persisted data
- `undefined` is usually used in TypeScript view models where a field is optional or omitted from a response

When crossing the network boundary, keep the payload serializable and prefer explicit `null` over omitted nested values where the distinction is meaningful.

## Type Inference And Generic Utility Types

The codebase uses a few common TypeScript utilities:

- `Omit` for safe client DTOs
- `Pick` for compact lookup items
- `Record` for keyed UI state and cache maps
- `Partial` for optimistic overlays and update payloads

That is the right level of type system complexity for this project. Keep future additions simple and explicit.

## Frontend Versus Backend Type Boundaries

The boundary should be:

- Prisma models and `lib/data` helpers on the backend side
- serializable DTOs in `types/*`
- view-model types in `types/ui.ts` for presentation-only screens

Do not import raw Prisma model types into client components unless they are first converted into serializable shapes.

## UI-Only Types

`types/ui.ts` contains a number of presentation models that are not persisted domain entities.

Examples include:

- `NavItem`
- `ProjectDetailTabKey`
- `ProjectDetailKpi`
- `ProjectBudgetPoint`
- `ProjectMaterialItem`
- `ProjectPaymentItem`
- `WorkerAttendanceItem`
- `QuoteRequestItem`
- `VariationTimelineImpact`
- `SiteUpdateItem`
- `TradieItem`

These are effectively screen models. They should be treated as UI contracts, not as business schema.

## Real-World Meaning Of Key Relationships

- a project belongs to one customer and may be assigned to one site manager
- a milestone belongs to one project and can have files, site updates, and tradie schedules attached
- a tradie can be scheduled many times across many projects
- a site update can belong to a milestone, but the milestone is optional
- a variation belongs to one project and can shift later milestone dates

Understanding those relationships is essential when changing any of the live workflows.

## Lifecycle And State Transitions

The most important transitions in the repository are:

- project status changes in the project workflows
- milestone status changes when a photo-required update completes a milestone
- variation approval, which can shift downstream milestones and project end date
- schedule confirmation, decline, and reminder escalation in tradie coordination

These transitions are the real business logic of the app. They should stay explicit in code and in documentation.

## Type Risks And Gaps

- there is no single API response envelope type yet
- some UI types in `types/ui.ts` still reflect mock-era screens rather than live entities
- some feature DTOs are defined near the store slice instead of in shared type modules

## Recommended Type Hygiene

1. Keep frontend-facing DTOs serializable by construction.
2. Convert decimals to strings immediately after Prisma reads.
3. Use `Safe*` naming for any model that crosses the client boundary.
4. Keep view-only types separate from persisted domain models.
5. Introduce shared response types for route handlers once more endpoints converge on a consistent envelope.
