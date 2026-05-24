# UI and React Best Practices Audit — 2026-05-21

## Scope

Audit of Royal Construction / BuildPro UI, accessibility, responsive behavior, React/Next.js data flow, bundle/performance risks, and cleanup targets.

## Highest Priority Findings

1. Verification gates are currently blocked: `pnpm lint` and `pnpm typecheck` fail before scripts run because `pnpm-workspace.yaml` has no `packages:` field, and `npm run lint` cannot find `eslint` because dependencies are not installed.
2. The leads surface is the largest UI and maintenance risk: `components/leads/leads.tsx`, `components/leads/views/table-view.tsx`, `pipeline-view.tsx`, and `followups-view.tsx` duplicate modal, toast, email-template, date, and phone helpers.
3. Several custom UI primitives are not accessible enough: custom dialogs lack focus management, tabs lack tab semantics, dropdowns lack keyboard/menu semantics, icon-only buttons rely on `title`, and some clickable spans/divs are mouse-only.
4. React performance has avoidable rerender/fetch issues: `components/common/app-shell.tsx` updates top-level time state every second, leads can fetch `/api/leads` twice on load, and projects/tradies client components risk immediate post-hydration refetches.
5. Bundle risks: `components/leads/views/table-view.tsx` statically imports `xlsx`, and barrel imports need an explicit scan under Vercel `bundle-barrel-imports` before changing imports.
6. Visual system drift: `app/globals.css` contains 2366 lines with feature-specific leads styling, local `Inter` font usage conflicts with root font variables, and custom animations need reduced-motion handling.
7. Data truthfulness risk: `components/leads/views/analytics-view.tsx` mixes live-derived source data with static/mock trend and lost-reason chart data. The cleanup scope is limited to labeling demo/sample data; real analytics wiring is a separate product task.

## Review Corrections Applied

- Replaced invalid `allowBuilds` workspace guidance with valid `packages`, `onlyBuiltDependencies`, and `ignoredBuiltDependencies` guidance for pnpm 9.
- Added regression gates before and after each cleanup phase.
- Added `components/ui/dialog.tsx` prerequisite check; file exists in this repo.
- Removed `/api/leads` response-shape changes from this cleanup plan.
- Added `React.cache()` as the server/RSC dedupe pattern where applicable, while keeping current client fix API-compatible.
- Added barrel-import and rerender scan passes.
- Added a dedicated globals CSS containment sub-plan.

## Plans

- Main plan: `docs/superpowers/plans/2026-05-21-ui-react-best-practices-remediation.md`
- CSS sub-plan: `docs/superpowers/plans/2026-05-21-globals-css-containment-subplan.md`
