# Impeccable fix spec — Projects & Tradie Management

Shared contract for the 8 parallel fix threads. Derived from the `$impeccable audit`
that scored these surfaces **7/20 (Poor)**. Every thread applies **all** of the
rules below to **only the files it owns**. Read this file completely before editing.

Authoritative references, in this order of precedence:
1. `DESIGN.md` (token values, named rules, do/don't)
2. `PRODUCT.md` (register, users, anti-references)
3. This spec

---

## 0. Ground rules

- **Stay inside your file list.** If a fix seems to require editing a file you do
  not own, do not edit it — note it in your report as a cross-file dependency.
  Another thread owns it.
- **The shared layer is already done. Do not re-do it.** Already committed:
  - `app/globals.css` — `--primary` darkened, `-ink` tokens added
  - `constants/tradeChip.ts` — trade chip classes
  - `components/common/data-table.tsx` — keyboard rows, `align`, `caption`, `rowLabel`
  - `components/common/metric-card.tsx` — semantic `tone` prop
  - `components/common/rating-stars.tsx` — canonical; `rating-star.tsx` deleted
- **Preserve behaviour.** This is a quality pass, not a rewrite. Do not change data
  shapes, API calls, Redux actions, or business logic except where a rule below
  explicitly says to.
- **Verify before reporting done:** `pnpm typecheck` and `pnpm lint` must both pass.
  There are no UI tests, so those two are the gate.
- Do not run `pnpm build` (slow, and another thread may be mid-edit).
- Do not commit, do not touch git.

---

## 1. Colour — use tokens, never raw palette

**Delete every raw Tailwind palette utility** (`bg-teal-600`, `text-slate-400`,
`border-red-200`, `text-emerald-700`, `bg-[#E8730C]`, …). There were 783 across
61 files; your job is to get your files to zero.

| Instead of | Use |
|---|---|
| `bg-teal-600`, `bg-teal-500` | `bg-primary` |
| `text-teal-600/700` | `text-primary` |
| `border-teal-600`, `ring-teal-*` | `border-primary`, `ring-ring` |
| `text-slate-900`, `text-slate-700` | `text-foreground` |
| `text-slate-500`, `text-slate-400` | `text-muted-foreground` |
| `border-slate-200`, `border-slate-100` | `border-border` |
| `bg-slate-50`, `bg-slate-100` | `bg-muted` |
| `bg-white` | `bg-card` |
| `bg-emerald-*`/`green-*` fill | `bg-success` |
| `text-emerald-700`/`green-700` | `text-success-ink` |
| `bg-amber-*`/`yellow-*` fill | `bg-warning` |
| `text-amber-700`, `text-[#D97706]` | `text-warning-ink` |
| `bg-red-*` fill | `bg-destructive` |
| `text-red-600/700` | `text-destructive-ink` |
| `bg-blue-*` fill | `bg-info` |
| `text-blue-700` | `text-info-ink` |
| tinted badge background | `bg-success-light` / `bg-warning-light` / `bg-destructive-light` / `bg-info-light` |

**The three-role rule.** Each status token has three variants and they are not
interchangeable:
- `--x` — **fill only**: dots, bars, icon container backgrounds, chart series
- `--x-light` — **surface only**: tinted badge/callout backgrounds
- `--x-ink` — **text only**: label text and icon strokes

`--warning` is 2.05:1 against white. **Never use `--warning`, `--success` or
`--info` as a text colour.** Always `-ink` for text.

**Status badge pattern** (use this exact shape everywhere):
```tsx
<span className="rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning-ink">
```

**No gradients, no decorative shapes.** `DESIGN.md`: *"Don't introduce dark-themed
panels, sections, or feature areas outside the sidebar rail."* Remove
`bg-gradient-to-*` / `bg-linear-to-*` panels and replace with a flat
`bg-card border border-border/70 shadow-sm` header. Delete decorative absolutely
positioned circles (`bg-white/5`, `bg-teal-500/10`, etc.) entirely.

**Never convey status by colour alone.** Every coloured dot/bar needs an adjacent
text label, or an `aria-label` if it is the only carrier of meaning.

---

## 2. Typography — use the scale

- **Delete every `text-[Npx]`.** Map to the nearest scale step:
  `9px/10px/10.5px/11px/11.5px → text-xs` · `12px/12.5px/13px → text-sm` ·
  `14px → text-sm` · `18px → text-lg` · `20px → text-xl` · `22px → text-2xl` ·
  `26px → text-3xl`.
  **Nothing may render below `text-xs` (12px).** Note `globals.css` sets
  `html { zoom: 0.8 }` under 1024px, so a nominal 9px renders at ~7px.
- **Delete `font-bold` and `font-extrabold`.** The scale is 400/500/600 only →
  `font-normal` / `font-medium` / `font-semibold`. Emphasis comes from size and
  colour, not weight 700+.
- **Fraunces (`font-heading`) only** on KPI values, section headings, milestone
  titles and page anchors. Never on nav, labels, table cells or button copy.
- **`font-mono` + `tabular-nums`** on money, IDs, timestamps, phone numbers, ABNs,
  reference codes (DESIGN.md Mono Precision Rule).
- Drop `tracking-[0.1em]`+ on uppercase labels; the label spec is `0.02em`
  (`tracking-wide` at most).
- **Kill the eyebrow reflex.** `text-[11px] font-bold uppercase tracking-[0.14em]
  text-slate-400` used as a card title appeared 38×. A card title is
  `text-base font-semibold text-foreground`. Keep at most one deliberate kicker
  per page, and only if it carries information.

---

## 3. Accessibility — WCAG 2.1 AA

- **Tabs.** Any tab-like control needs the real pattern: wrapper
  `role="tablist"`, each trigger `role="tab"` + `aria-selected` +
  `aria-controls` + `id`, each panel `role="tabpanel"` + `aria-labelledby`, and
  arrow-key navigation with a roving `tabIndex` (`0` on active, `-1` on the rest).
- **Never `focus:outline-none` without a replacement.** Use
  `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.
  Focus must always be visible.
- **No interactive nesting.** No `<Link>` inside `<button>`, no `<Button>` inside
  `<Link>`. For a link styled as a button use `<Button asChild><Link …/></Button>`.
- **Clickable cards/rows/divs** must be real controls: either make the element a
  `<button>`/`<Link>`, or add `role="button"` + `tabIndex={0}` + `aria-label` +
  Enter/Space handling. If the card contains its own buttons or menus, the
  wrapper must not be a `<button>` — use a `<Link>` over the title plus a
  click-through on the card body, and `stopPropagation` on the inner controls.
- **Icon-only controls need `aria-label`.** `title` is not sufficient. This
  includes controls whose label is hidden at a breakpoint (`hidden sm:inline`) —
  those still need an `aria-label` for the small-viewport state.
- **Toggles need state:** `aria-pressed` on toggle buttons, `aria-current="page"`
  on active nav.
- **Progress bars:** `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/
  `aria-valuemax` and an accessible name.
- **Forms:** every input needs a real `<label>` (or `aria-label`). Placeholder is
  never a label. Errors referenced by `aria-describedby`, invalid fields
  `aria-invalid`.
- **Dropdowns/menus:** use the shadcn `DropdownMenu` / `Select` primitives. Do not
  hand-roll. `components/tradie-management/tradie-actions.tsx` is the reference.
- **Headings:** one `<h1>` per page (the page title), then no level skips.
- **Decorative icons** get `aria-hidden="true"`; meaningful ones get a label.
- **Touch targets ≥ 44×44px** for primary controls; never below 32px CSS
  (remember the 0.8 zoom).

---

## 4. Motion

- 150–250 ms, ease-out. Transition `opacity`, `transform`, `background-color`,
  `border-color` only.
- **Remove `hover:-translate-y-*` and `hover:shadow-md`/`hover:shadow-lg`
  entirely.** DESIGN.md Flat-at-Rest Rule: hover is a background tint
  (`hover:bg-muted/40`) or a border shift, never a lift or a shadow change. The
  elevation scale is exactly three planes: flat ground, `shadow-sm` cards,
  `shadow-lg` floating.
- Any remaining animation needs a `@media (prefers-reduced-motion: reduce)`
  fallback (or use a `motion-reduce:` variant).

---

## 5. Loading, empty and error states

- **Never unmount content to show a loading message.** Keep the list mounted and
  dim it (`opacity-60 transition-opacity`), or swap in a skeleton that matches
  the real layout. No bare "Loading…" text bars replacing content.
- **Loading regions** get `aria-busy` and, for result counts, `aria-live="polite"`.
- **Empty states must distinguish "no data" from "no matches".** If any filter or
  search is active, say so and offer a "Clear filters" action. Teach the
  interface, don't just say "nothing here".
- **Never swallow errors.** `catch { console.error() }` is not handling. Surface a
  `toast.error` with a retry affordance, and keep the prior data visibly stale
  rather than silently stale.
- **No mock data in rendered UI.** Where a panel is backed by
  `lib/mock-data`, replace it with an honest empty state that names what would
  appear there ("Attendance tracking not enabled for this project"). Remove any
  fabricated confidence signal (e.g. a "GPS Active" indicator). Delete the
  `mock-data` import.

---

## 6. Copy

- Sentence case for labels and buttons. No exclamation marks.
- Say what the thing is, not how to operate the mouse. "View flagged tradies",
  not "Click to view flagged tradies".
- Format all money through `currency` / `compactCurrency` from `utils/formatters`.
  Never hand-roll `${Math.round(n/1000)}K` and never interpolate a raw number
  after a `$`. Guard nulls — no bare `$`.
- Format all dates through `dateFormat` / `shortDateFormat`.
- Status labels are title case via a shared formatter, never a raw enum
  (`NEEDS_ATTENTION` → "Needs attention").
- No dev-facing strings in UI ("loaded from Prisma", "coming soon!").
- Remove commented-out JSX and dead props rather than leaving them in place.

---

## 7. Correctness traps found in the audit

Fix these classes of bug wherever they appear in your files:

- **Hardcoded status.** Any badge/dot whose value is a literal rather than derived
  from data (a permanently green dot, a permanently "On Budget" badge). Derive it,
  or delete it.
- **Unguarded config lookups.** `configMap[value].prop` crashes on an unmapped
  enum. Always `configMap[value] ?? configMap.FALLBACK`.
- **Division by zero** producing `NaN`/`Infinity` in percentages. Guard the
  denominator.
- **Colour thresholds that misread data.** Low progress on a new project is not an
  error state; don't paint it red. Only signal a problem when the data says there
  is one (e.g. behind schedule, over budget).
- **Dead controls.** A button with no handler must be wired or removed. Never ship
  a control that does nothing.
- **`key` including volatile values** (e.g. a count) forces remount and drops
  focus — key on stable identity only.
- **Duplicated content** — the same field rendered twice in one block is a bug;
  work out what the second slot was meant to show and render that, or remove it.

---

## 8. Report format

Return a terse report, not a narrative:

```
FILES CHANGED: <paths>
FILES DELETED: <paths>
TYPECHECK: pass|fail (+ error if fail)
LINT: pass|fail (+ error if fail)
FIXED: one line per fix, grouped by category, each naming file:line
DEFERRED: anything you could not fix, and why (esp. cross-file dependencies)
NEW ISSUES FOUND: anything real you noticed that this spec doesn't cover
```
