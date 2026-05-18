# Coding Standards

This is the engineering handbook for the repository. It describes the standards that new code should follow and the technical debt that still exists today.

## Non-Negotiable Standards

1. Keep server-side data access in `lib/data` or route handlers, not in React components.
2. Keep client components focused on rendering and interaction.
3. Return serializable payloads across the client boundary.
4. Preserve auth checks at the request boundary, not only in the UI.
5. Revalidate or refresh canonical data after mutations that affect server-rendered views.

## Type Safety Rules

- Do not pass raw Prisma decimals to the client.
- Do not store non-serializable values in Redux unless there is no alternative and the exception is documented.
- Prefer explicit DTOs over `any` or untyped JSON.
- Use union types and discriminated states for modal and mutation state.
- Keep request payloads and response payloads separate.

## Function Design Principles

- Keep functions small and purpose-built.
- Prefer one clear responsibility per function.
- Use helper functions for query building, mapping, and validation instead of inlining everything in a route handler.
- Return canonical entity payloads after mutations when the UI depends on nested relations.

## Component Design Principles

- Shared UI should stay dumb and reusable.
- Feature components may own view logic, but they should not reach into unrelated features.
- Keep modal bodies in the feature folder and modal orchestration in the coordinator.
- Use card, section, and table patterns consistently so screens feel like one product.

## Separation Of Concerns

The repository should continue to use these boundaries:

- `app/` = routing and request handling
- `components/` = rendering and interaction
- `lib/data/` = Prisma queries and server-side DTO mapping
- `lib/store/` = Redux state and async coordination
- `utils/` = pure helpers

Do not collapse these layers together just to reduce file count.

## Reusability Strategy

The preferred pattern is:

- shared primitive in `components/common` or `components/ui`
- feature-specific composition in `components/<feature>`
- shared query logic in `lib/data`
- shared state coordination in `lib/store`

If a helper is only used once, keep it local. If it starts being reused, extract it deliberately.

## Naming Conventions

- component files: `PascalCase.tsx`
- utility files: `camelCase.ts` or domain-named files
- route handlers: `route.ts`
- slices: `camelCaseSlice.ts`
- DTOs: suffix with `Request`, `Response`, `Item`, `State`, or `Dashboard` as appropriate

## Error Handling Standards

- Validate inputs at the boundary and fail fast.
- Return readable error strings to the UI.
- Log enough context to identify the request or entity that failed.
- Do not swallow failures silently.
- Avoid mixing plain-text and JSON error styles in the same domain unless there is a reason.

## Logging Strategy

Current logging is simple and console-based.

That is acceptable for now, but logs should still be actionable:

- include the route or domain in the message
- include the failing entity id when possible
- avoid dumping secrets or entire payloads

## Validation Requirements

- Route handlers must validate required fields before writing.
- Enum-like query strings should be checked against the actual allowed values.
- Date strings and numeric fields should be normalized before persistence.
- If a flow becomes more complex, introduce a schema validator rather than adding more hand-rolled checks.

## Async Handling Standards

- Use `Promise.all` for independent reads.
- Use `createAsyncThunk` for Redux async flows.
- Prefer `async/await` over nested promise chains.
- Keep route handlers single-purpose and keep transaction logic inside helpers when it grows.

## API Calling Standards

- Use `fetchJson()` for client calls that expect JSON and want a consistent fallback error message.
- Use direct `fetch()` only when the caller needs special handling.
- Prefer route handlers over calling Prisma from client code.
- Return refreshed canonical records after mutation when the UI depends on nested relations.

## Data Transformation Rules

- Convert Prisma decimals to strings immediately after reading.
- Convert date objects to serializable strings at the API boundary.
- Keep transformation code close to the data access layer.
- Do not bury data mapping deep inside React view code.

## File Size And Complexity Limits

These are practical targets, not hard compiler limits:

- keep shared primitives small and boring
- split feature screens once they become difficult to scan in one pass
- if a component mixes layout, data fetching, and mutation orchestration, split it
- if a slice accumulates several unrelated domains, split it

## Refactoring Expectations

Refactor when you see:

- duplicated pagination or lookup logic
- repeated DTO mapping
- repeated error handling blocks
- feature logic leaking into shared components
- state that is only used to support a single local form

## Testing Philosophy

The repository does not yet show a broad automated test suite in the inspected paths.

That means the current standard should be:

- validate the changed slice or route directly
- check the data contract after any API change
- ensure new mutations return the shape the UI expects
- add tests when a flow becomes non-trivial or business-critical

## Performance Standards

- use server rendering for initial data where possible
- cache reusable reads with Next cache tags or `unstable_cache`
- paginate large lists
- debounce search-driven refetches
- avoid unnecessary client re-renders by keeping derived state local or memoized

## Accessibility Standards

- every icon-only control needs an accessible label
- keep focus rings visible
- do not encode meaning through color alone when the text label is easy to show
- dialogs and drawers must remain keyboard accessible
- ensure empty and error states are readable, not just decorative

## Security Considerations

- auth must be enforced at the request boundary
- webhook and cron endpoints should use their expected secret or signature checks
- never trust client-provided ids or status strings without validation
- treat file uploads as untrusted input until Blob and database persistence succeed

## Caching Strategy

The current cache model uses:

- `unstable_cache` for server-side lookup and data helpers
- `revalidateTag` after writes
- a small client-side tradie dashboard cache in Redux

This is fine short term, but it should not spread further without a clear invalidation story.

## Revalidation Strategy

The current pattern is:

1. mutate the database
2. revalidate the relevant tag
3. return the refreshed canonical entity
4. update client state from the returned payload

That is the right pattern for nested project and tradie workflows.

## Memoization Strategy

- use memoization for derived UI state that is expensive or reused
- do not memoize everything by default
- keep cache keys deterministic and derived from the real query state

## Server/Client Rendering Considerations

- prefer server components for initial data when the screen is data-heavy
- use client components only for interactivity and local coordination
- keep shell-level wrappers client-side only when they truly need browser APIs or user interaction

## Data Fetching Optimization Patterns

- cache repeated lookups
- reuse server helpers instead of re-querying in multiple places
- batch independent database reads
- keep lookup queries narrow
- avoid overfetching full nested relations for list screens that only need summary data

## Parallelization Standards

- use parallel reads for independent aggregates
- keep transactions for writes that must remain consistent
- do not parallelize dependent operations that must happen in sequence

## Segmentation And Modularity

The code should be segmented by concern, not by arbitrary file count.

Good segmentation looks like:

- shared primitive
- feature component
- feature data helper
- feature slice
- feature types

Bad segmentation looks like:

- one large global utility file
- one mega slice for unrelated modules
- route handlers that also contain detailed business mapping logic

## Existing Technical Debt

- middleware auth matcher is wrong today
- some API routes do not enforce auth consistently
- `serializableCheck` is disabled globally
- lookup pagination logic is duplicated
- global CSS contains a feature-specific leads block
- `lib/mock-data.tsx` is overloaded

## Existing Anti-Patterns

- direct client fetches where the feature already has Redux async infrastructure
- ad hoc response envelopes
- mixed mock and live data in the same registry file
- feature-specific styling in the global stylesheet
- stateful coordination logic spread across slice, component, and route handler without a clean boundary

## Recommended Cleanup Strategy

1. Fix auth and route protection first.
2. Consolidate repeated lookup and pagination code.
3. Separate mock content from runtime registry data.
4. Normalize response envelopes and error handling.
5. Reduce the amount of business logic embedded in global styles and UI-only helpers.
