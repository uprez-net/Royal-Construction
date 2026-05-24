# Globals CSS Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce risk in `app/globals.css` without turning a UI audit cleanup into a broad redesign.

**Architecture:** Inventory first, patch accessibility-safe global issues, then isolate feature-specific CSS only where verification can prove no visual regression. Avoid introducing a CSS linter dependency in this task; use static scans plus browser verification.

**Tech Stack:** Next.js 16.2.6 App Router, Tailwind CSS 4, global CSS, CSS Modules where surgical component scoping is safe.

---

## Constraints

- No full 2366-line rewrite in one pass.
- No design-token redesign unless separately requested.
- No new CSS tooling dependency such as Stylelint in this plan.
- Every CSS move must be paired with browser verification for the affected route.

---

## Task 1 — Inventory Global CSS Risk

**Files:**
- Read: `app/globals.css`

- [ ] Run inventory scans.

```bash
wc -l app/globals.css
rg -n "LEADS COMPONENT STYLES|@keyframes|font-family|outline:\s*none|cursor pointer|prefers-reduced-motion|\.leads-|\.lead-" app/globals.css
```

Expected: exact anchors for feature-specific blocks, animation blocks, font drift, outline resets, and typo-level CSS defects.

- [ ] Record findings in `docs/audits/2026-05-21-ui-react-baseline.md` under `Globals CSS inventory`.

---

## Task 2 — Add Reduced-Motion Safety

**Files:**
- Modify: `app/globals.css`

- [ ] If no broad reduced-motion block exists, add this near the global base/accessibility section:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] Verify:

```bash
rg -n "prefers-reduced-motion|animation-duration: 0.01ms|transition-duration: 0.01ms" app/globals.css
pnpm build
pnpm lint
```

Expected: reduced-motion block exists; build/lint do not regress beyond known baseline.

---

## Task 3 — Fix Typo-Level CSS Defects

**Files:**
- Modify: `app/globals.css`

- [ ] Replace confirmed invalid utility typos such as `cursor pointer` with the correct CSS or class usage.

Verification:

```bash
rg -n "cursor pointer|outline:\s*none" app/globals.css components
pnpm build
pnpm lint
```

Expected: typo is gone; any remaining `outline: none` has a visible replacement focus style.

---

## Task 4 — Contain Leads-Specific CSS Surgically

**Files:**
- Modify: `app/globals.css`
- Modify only if chosen after inventory: lead components using the moved classes.

- [ ] Identify whether the large leads block is already scoped under `.leads-container`.

Run:

```bash
rg -n "^\.leads-container|^\.leads-|^\.lead-" app/globals.css | head -80
```

- [ ] If selectors are safely scoped and moving them would require mass class rewrites, do not convert to CSS Modules in this pass. Instead, add a comment boundary and keep the sub-plan focused on reduced-motion, focus, font drift, and typo fixes.

- [ ] If a small leaf component has isolated global classes, move only that leaf to a CSS Module and update that component.

Verification for any moved CSS:

```bash
pnpm build
pnpm lint
```

Browser expected:

```text
/leads visually matches baseline at 375, 768, 1024, and 1440 px except intentional accessibility/reduced-motion changes
```

---

## Task 5 — Font and Token Drift Decision

**Files:**
- Read: `app/layout.tsx`
- Read/Modify only if scoped: `app/globals.css`

- [ ] Compare root font variables against local leads font override.

Run:

```bash
rg -n "Manrope|Fraunces|IBM Plex Mono|Inter|font-family" app/layout.tsx app/globals.css components/leads
```

- [ ] If `Inter` is not loaded and only appears in leads CSS, replace the local override with the existing app font variable. Do not introduce a new font in this cleanup task.

Verification:

```bash
pnpm build
pnpm lint
```

Browser expected:

```text
/leads typography remains readable and aligned with app shell; no flash/missing-font regression
```
