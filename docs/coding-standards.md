# Coding Standards

This document describes the current conventions for new code in this repository. It is implementation-driven: the rules below reflect the helpers, slices, validators, and route patterns that exist today.

## Non-Negotiables

1. Keep server-side data access in `lib/data` or route handlers, not in React components.
2. Keep client components focused on rendering and interaction.
3. Return serializable payloads across the client boundary.
4. Preserve auth checks at the request boundary, not only in the UI.
5. Revalidate or refresh canonical data after mutations that affect server-rendered views.

## General Code Quality

- No unused variables.
- No unused imports.
- No dead code.
- No commented-out code committed to the repository.
- Prefer explicit typing over implicit `any`.
- Avoid type assertions unless they are the smallest practical option.
- Lint must pass with zero warnings and zero errors.

## File Structure

- No file should exceed 500 lines.
- If a file is approaching 500 lines, extract hooks, utilities, UI, or business logic before it becomes harder to scan.
- Prefer composition over large monolithic files.
- Keep feature-specific logic close to the feature, and shared primitives in `components/common` or `components/ui`.

## Type Safety

- Do not pass raw Prisma decimals to the client.
- Do not store non-serializable values in Redux unless the exception is intentional and documented.
- Prefer explicit DTOs over untyped JSON.
- Keep request payloads and response payloads separate.
- Use union types and discriminated states for modal and mutation state.

## React Standards

### State Management

- Avoid `setState` inside `useEffect` when the value is derived from existing props, Redux, or query results.
- Derive state directly from props or query results when possible.
- Use memoization when a derived value is expensive or reused.
- Use Redux or React Query for async state.

Bad:

```tsx
useEffect(() => {
	setData(result);
}, [result]);
```

### Initial Data Loading

- Initial application data loading should be handled by Redux or React Query.
- Avoid local component state for initial server-loaded data.

### Effects

- Effects should synchronize with external systems.
- Effects should not exist solely to transform data.
- Prefer `useMemo` for derived values.
- Prefer `useEffectEvent` where applicable.

## Data Fetching Standards

- Use `fetchJson()` for client calls that expect JSON.
- Do not add untyped `fetch()` calls when a shared helper already exists.
- Do not manually parse response bodies when helper functions already exist.
- Prefer centralized API utilities over feature-local request wrappers.
- Use the existing response shape exposed by `fetchJson()` on the client.

## Redux Standards

- Use Redux for global state, shared application state, modal state, and cross-page coordination.
- Avoid Redux for temporary UI-only state or local form interactions.
- Use `createAsyncThunk` for Redux async flows.
- Keep Redux state serializable where possible.
- Treat Redux as coordination state, not a replacement for the database.

## Modal Standards

- All shared modals must be registered and managed through the centralized modal manager.
- Do not add ad-hoc modal mounting patterns for cross-feature workflows.
- Do not duplicate modal state management across features.
- New modals must be registered in the modal manager, use Redux state, and follow existing modal conventions.

## API Standards

- New list endpoints should support `page` and `limit`.
- New search-capable endpoints should support `search` or `q` as appropriate to the existing domain conventions.
- Design endpoints for future scalability, even when the current UI does not use every filter yet.
- Keep route handlers single-purpose.

## Request Validation

- Validate all request bodies at the route boundary.
- Use shared validators from `utils/validators`.
- Reuse schemas whenever possible.
- Centralize validation logic instead of repeating ad hoc checks.
- Normalize date strings and numeric fields before persistence.

Shared validation helpers already exist in the repository, including `utils/validators/common.ts`, `lead.ts`, `projects.ts`, `files.ts`, `material.ts`, `milestone.ts`, `notification.ts`, and `response.ts`.

## Server Response Standards

- Use the shared response helpers in `utils/validators/response.ts` for new route work.
- Prefer standardized success, paginated, validation-error, and error helpers.
- Avoid `NextResponse.json(...)` in new code when a project helper already exists.
- Keep response shapes consistent so client code can rely on stable error handling.

## Performance Standards

- Parallelize independent database queries.
- Avoid sequential queries where `Promise.all` is a better fit.
- Minimize database round trips.
- Avoid unnecessary client re-renders.
- Memoize expensive calculations.
- Use server-side caching and revalidation helpers when the data is reused across requests.

## Database Standards

- Prefer Prisma transactions when multiple writes must stay consistent.
- Keep database connection usage efficient.
- Avoid N+1 query patterns.
- Reuse existing query helpers.
- Return refreshed canonical records when the UI depends on nested relations.

## Component Standards

- Prefer reusable components.
- Prefer shared UI primitives.
- Keep business logic out of presentational components.
- Extract hooks when logic becomes complex.

## Function Design Principles

- Keep functions small and purpose-built.
- Prefer one clear responsibility per function.
- Use helper functions for query building, mapping, and validation instead of inlining everything in a route handler.

## Error Handling Standards

- Validate inputs at the boundary and fail fast.
- Return readable error strings to the UI.
- Log enough context to identify the request or entity that failed.
- Do not swallow failures silently.
- Avoid mixing plain-text and JSON error styles in the same domain unless the domain already requires it.

## Logging Strategy

- Keep logs actionable.
- Include the route or domain in the message.
- Include the failing entity id when possible.
- Avoid dumping secrets or entire payloads.

## Naming Conventions

- Component files: `PascalCase.tsx`
- Utility files: `camelCase.ts` or domain-named files
- Route handlers: `route.ts`
- Slices: `camelCaseSlice.ts`
- DTOs: suffix with `Request`, `Response`, `Item`, `State`, or `Dashboard` as appropriate

## Reusability Strategy

- Shared primitive in `components/common` or `components/ui`
- Feature-specific composition in `components/<feature>`
- Shared query logic in `lib/data`
- Shared state coordination in `lib/store`

If a helper is only used once, keep it local. If it becomes reused, extract it deliberately.

## Rendering And Caching

- Prefer server components for initial data when the screen is data-heavy.
- Use client components only for interactivity and local coordination.
- Keep shell-level wrappers client-side only when they need browser APIs or user interaction.
- Use `unstable_cache` and `revalidateTag` where the repository already does so.

## Validation And Contracts

- Route handlers must validate required fields before writing.
- Enum-like query strings must be checked against the actual allowed values.
- Response and request payloads should stay separate.
- If a flow becomes more complex, introduce a schema validator instead of adding more manual guards.

## Testing Philosophy

- Validate the changed slice or route directly.
- Check the data contract after any API change.
- Ensure new mutations return the shape the UI expects.
- Add tests when a flow becomes non-trivial or business-critical.

## Accessibility Standards

- Every icon-only control needs an accessible label.
- Keep focus rings visible.
- Do not encode meaning through color alone when the text label can be shown.
- Dialogs and drawers must remain keyboard accessible.
- Ensure empty and error states are readable, not just decorative.

## Security Considerations

- Auth must be enforced at the request boundary.
- Webhook and cron endpoints should use the expected secret or signature checks.
- Never trust client-provided ids or status strings without validation.
- Treat file uploads as untrusted input until Blob and database persistence succeed.

## Current Implementation Notes

- `fetchJson()` is the common client helper for JSON requests.
- `utils/validators/response.ts` is the shared response-helper layer for new API code.
- Redux currently holds project, tradie, customer, site manager, quote, and UI coordination state.
- The centralized modal manager renders shared modals from Redux state.
- React Query is currently used in the notification provider, the app shell, and a small number of local query shells.

## Suggested Workflow For New Work

1. Add or reuse a validator in `utils/validators`.
2. Validate input in the route handler.
3. Query or mutate through `lib/data` helpers when the logic is reusable.
4. Return a shared response helper shape.
5. Revalidate tags or refresh Redux state if the UI depends on the result.
6. Keep feature UI thin and move orchestration into helpers, slices, or context.
