# Folder Structure

This document explains where code lives today, what belongs in each major directory, and how to organize new code without breaking the current conventions.

## Root Layout

| Path | Purpose |
| --- | --- |
| `app/` | Next.js App Router pages, layouts, and API routes |
| `components/` | Shared UI, feature screens, and modal flows |
| `hooks/` | Browser-only reusable hooks |
| `lib/` | Server helpers, store setup, mock registry, utilities, and domain data access |
| `prisma/` | Schema, seed script, and migrations |
| `types/` | Shared domain, UI, and DTO types |
| `utils/` | Pure helpers used across the app and feature code |
| `public/` | Static assets |
| `docs/` | Internal engineering documentation |

## `app/`

The `app` directory is the routing layer.

### What belongs here

- route pages and route groups
- layouts and providers that depend on routing context
- API route handlers under `app/api`
- auth pages, profile pages, and server-rendered entry points

### Current substructure

- `app/(main)` wraps authenticated screens in the global shell
- `app/api/(data)` holds the data endpoints consumed by the UI
- `app/api/upload`, `app/api/webhook`, and `app/api/cron` isolate integration surfaces
- `app/sign-in` and `app/sign-up` host Clerk flows

### What should not go here

- reusable UI primitives
- Prisma query code
- Redux slice logic
- generic utility functions

## `components/`

This is the visual and interaction layer.

### Shared primitives

`components/common` contains reusable surfaces that multiple domains share:

- `app-shell.tsx`
- `data-table.tsx`
- `metric-card.tsx`
- `section-card.tsx`
- `status-pill.tsx`

These files should stay generic. If a component only works for one feature, it should not live here.

### Feature directories

Feature-specific code is currently grouped by domain:

- `components/projects`
- `components/tradies`
- `components/dashboard`
- `components/leads`
- `components/project`
- `components/charts`

These folders should contain feature screens, dialogs, tabs, and small helpers that are only useful to that feature.

### Provider and modal layers

- `components/providers` contains client-only context providers such as the Redux wrapper
- `components/modals` contains the top-level modal coordinator

### Shared UI primitives

`components/ui` is the low-level design system layer. These primitives should stay presentational and should not gain feature logic.

## `lib/`

The `lib` folder holds non-visual application infrastructure.

### `lib/data/`

This is the canonical place for reusable server-side query modules.

Current examples:

- `lib/data/projects.ts`
- `lib/data/tradies.ts`
- `lib/data/customers.ts`
- `lib/data/siteManagers.ts`
- `lib/data/user.ts`
- `lib/data/file.ts`

Use this folder for:

- Prisma queries
- DTO mapping and serialization
- cache tags and `unstable_cache`
- domain-level helper functions used by route handlers and server components

Do not place client-side React logic here.

### `lib/store/`

This is the Redux store layer.

- `index.ts` builds the store
- `hooks.ts` exposes typed hooks
- `slices/` contains feature slices

### `lib/utils/`

This folder is for pure utility logic that is not tied to a React component tree.

Current examples include schedule delay logic and other domain helpers.

### `lib/mock-data.tsx`

This file is the main organization outlier.

It currently mixes:

- route registry data
- navigation metadata
- dashboard fixtures
- several mock screen payloads

It should eventually be split into separate modules because it is doing too many jobs.

## `hooks/`

The top-level `hooks` folder is for shared React hooks that are browser-facing and not tightly coupled to Redux or a single feature.

Examples in this repository include mobile detection and feature-specific search hooks.

If a hook is only used in one feature, keep it beside that feature instead.

## `types/`

The `types` folder holds shared domain and presentation types.

- `types/project.ts` contains domain DTOs and project/tradie state models
- `types/ui.ts` contains UI-focused view models
- `types/data.ts` contains external data models such as address suggestions

Use this folder when the type is shared across server and client code or across multiple feature modules.

## `utils/`

The top-level `utils` folder is for pure helpers that are consumed from both server and client code.

Current examples include:

- `utils/fetch.ts`
- `utils/formatters.ts`
- `utils/parser.ts`
- `utils/uiHelper.tsx`

This folder currently mixes domain-independent helpers with UI-oriented helpers. Long term, UI helpers should live closer to their feature or component layer.

## `prisma/`

Prisma schema and seeding live here.

- `schema.prisma` defines the data model and enums
- `seed.ts` creates the development dataset
- `migrations/` stores generated migration history

## `docs/`

This folder is for repository-specific engineering documentation.

The current set should be treated as the source of truth for architecture, folder boundaries, design rules, state management, and implementation status.

## Naming Conventions

The current repository follows these conventions:

- component files use `PascalCase.tsx`
- route handlers are always `route.ts`
- Redux slices use `camelCaseSlice.ts`
- server helper modules are named by domain, such as `projects.ts` or `tradies.ts`
- type files are named by domain or concern, such as `project.ts`, `ui.ts`, or `data.ts`

## Import Conventions

The codebase uses the `@/` alias for root-relative imports.

Use it for:

- cross-folder imports
- shared types and utilities
- store hooks and slices
- component imports from outside the local feature folder

Use relative imports only when the dependency is local to the same feature folder and the path remains short and obvious.

## Co-Location Pattern

The current good pattern is to keep feature subcomponents near the screen that uses them.

Examples:

- `components/projects/detail/*`
- `components/tradies/*`
- `components/charts/*`

This is the right direction for new feature work. It keeps feature logic from leaking into shared primitives.

## What Goes Where

| Code type | Best location |
| --- | --- |
| Shared button, card, table, badge, dialog primitive | `components/ui` |
| Shared app shell or common panel pattern | `components/common` |
| Feature screen, modal, tab panel, or detail card | `components/<feature>` |
| Prisma query and mapping logic | `lib/data` |
| Redux store, slice, or thunk | `lib/store` |
| Pure formatter, parser, or helper | `utils` or `lib/utils` depending on scope |
| Shared domain DTO or view model | `types` |
| API route handler | `app/api` |

## What Should Not Be Added To The Wrong Folder

- Do not add feature-specific logic to `components/common`.
- Do not add network fetches or Prisma code to `components/`.
- Do not add React rendering logic to `lib/data`.
- Do not add stateful browser code to `utils/`.
- Do not keep route metadata and dashboard mock payloads in the same file unless the file is truly a small registry.

## Current Organization Issues

The main violations of the intended structure are:

- `lib/mock-data.tsx` is overloaded
- `utils/uiHelper.tsx` is UI-aware but sits in the generic utility layer
- `components/tradies` is large and mixes many modal and screen concerns in one domain folder
- `app/api/(data)` uses a grouping name that reflects implementation rather than business meaning

## Recommended Structure Improvements

1. Split `lib/mock-data.tsx` into navigation, registry, and mock-content modules.
2. Move feature-local helpers and selectors next to the feature slice or screen that uses them.
3. Introduce a more explicit feature folder layout for large modules such as projects and tradies.
4. Keep server-only data helpers in `lib/data` and client-only state in `lib/store`.

## Suggested Modular Feature Template

For larger features, the future shape should look roughly like this:

```text
components/features/projects/
  components/
  hooks/
  detail/
  modals/
  index.ts
lib/store/slices/projectsSlice.ts
lib/data/projects.ts
types/project.ts
```

That structure keeps the feature self-contained while still allowing shared primitives and server helpers to stay centralized.
