---
name: BuildPro
description: Construction management for the people who build things
colors:
  site-teal: "oklch(0.584 0.118 183.6)"
  tradie-amber: "oklch(0.726 0.165 54.6)"
  site-red: "oklch(0.592 0.23 28.5)"
  slate-veil: "oklch(0.979 0.006 248.4)"
  card-white: "oklch(1 0 0)"
  night-slate: "oklch(0.232 0.032 253.7)"
  mid-slate: "oklch(0.498 0.03 253.3)"
  cool-border: "oklch(0.905 0.02 248.7)"
  sidebar-void: "oklch(0.16 0.03 249.8)"
  sidebar-hover: "oklch(0.221 0.03 250.1)"
  royal-gold: "oklch(0.694 0.12 77.3)"
  royal-gold-dark: "oklch(0.609 0.106 77.7)"
  royal-gold-light: "oklch(0.947 0.029 89.6)"
  royal-orange: "oklch(0.68 0.172 51.9)"
  royal-orange-light: "oklch(0.969 0.028 79.5)"
  success: "oklch(0.627 0.17 149.2)"
  warning: "oklch(0.769 0.165 70.1)"
  info: "oklch(0.546 0.215 262.9)"
  accent-purple: "oklch(0.541 0.247 293)"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.02em"
  mono:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.325rem"
  md: "0.425rem"
  lg: "0.5rem"
  xl: "0.675rem"
  2xl: "0.9rem"
  3xl: "1.1rem"
  4xl: "1.4rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  metric-card:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    padding: "16px 24px"
  metric-card-icon-primary:
    backgroundColor: "{colors.site-teal}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.2xl}"
    size: "44px"
  metric-card-icon-accent:
    backgroundColor: "oklch(0.648 0.208 37.1)"
    textColor: "{colors.card-white}"
    rounded: "{rounded.2xl}"
    size: "44px"
  section-card:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    padding: "16px 24px"
  button-primary:
    backgroundColor: "{colors.site-teal}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.night-slate}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  sidebar:
    backgroundColor: "{colors.sidebar-void}"
    textColor: "{colors.slate-veil}"
    width: "240px"
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-hover}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: BuildPro

## 1. Overview

**Creative North Star: "The Site Office"**

The Site Office is where the whole project lives. Plans on the desk, schedules on the wall. It is organized and purposeful, not sterile. Every screen in BuildPro carries that energy: information is dense because the work demands it, but the layout is never chaotic. The dark navigation rail is the building's steel frame. The white card surfaces are the work desk. The teal instruments are the controls you reach for without thinking.

This is a light-theme system. That is a permanent, deliberate choice, not a default. The physical scene: a construction business owner checking project status at 8am on a laptop in a bright site office, morning light coming through the window, coffee on the desk. That scene demands a light canvas. Dark mode is not a future direction, not a "we'll add it later" feature, and not an aspiration. The dark sidebar rail provides the structural contrast the eye needs without switching the entire system to a low-ambient aesthetic.

This system explicitly rejects three failure modes. Generic SaaS: pastel cards, bouncy micro-interactions, startup-template layouts. Old-school construction software: grey, dense, utilitarian enterprise chrome. Finance and banking dark mode: terminal-native precision with neon accents, a trading-floor aesthetic that carries the wrong register entirely. BuildPro is none of those. It is an operations centre for people who build things, running in daylight.

**Key Characteristics:**
- Light canvas (near-white with a faint cool tint) for work surfaces; dark navy rail for structure
- Site Teal as the single decisive action colour; Tradie Amber as the warm secondary for warnings and energy
- Three-layer elevation: background flat, cards at shadow-sm, modals at shadow-lg
- Sharper rounding (0.9rem on icon containers, 0.5rem on cards) so the app feels precise rather than soft
- Fraunces for editorial gravity; Manrope for operational speed; IBM Plex Mono for data precision

## 2. Colors: The Site Office Palette

Restrained-to-Committed strategy. The operational core uses Site Teal as its action signal, carrying 10–20% of any given screen; Tradie Amber appears in chart data, warning states, and the subtle body-background gradient. The leads and sales surfaces swap that action signal for Royal Gold (see Sales Accent below). The rest, everywhere, is the neutral slate family.

### Primary
- **Site Teal** (oklch(0.584 0.118 183.6)): Primary actions, focus rings, sidebar active states, the ring token, chart-1. The one colour that means "act here." Used at mid-saturation so it reads clearly without dominating.

### Secondary
- **Tradie Amber** (oklch(0.726 0.165 54.6)): Warm secondary energy. Used in chart-3, the body background gradient, warning icon containers (bg-amber-500), and anywhere time-sensitive information needs a warmer register than red. Not a status colour; an energy colour.

### Tertiary
- **Site Red** (oklch(0.592 0.23 28.5)): Destructive actions, error states, urgent indicators. High chroma. Reserved strictly for things going wrong.

### Neutral
- **Slate Veil** (oklch(0.979 0.006 248.4)): App background. Near-white with a near-invisible cool tint. Sits under card surfaces.
- **Card White** (oklch(1 0 0)): Card and popover surfaces. The work desk. Slight luminance above the background creates the depth layer.
- **Night Slate** (oklch(0.232 0.032 253.7)): Primary text and foreground. Deep, slightly blue-tinted. Not pure black.
- **Mid Slate** (oklch(0.498 0.03 253.3)): Secondary text, descriptions, muted labels.
- **Cool Border** (oklch(0.905 0.02 248.7)): Dividers, card borders, input strokes. Light, cool, structural.
- **Sidebar Void** (oklch(0.16 0.03 249.8)): The navigation rail. Very dark navy. The steel frame.
- **Sidebar Hover** (oklch(0.221 0.03 250.1)): Sidebar item hover. One step lighter than the rail.

### Sales Accent (Royal Constructions)

The leads and sales surfaces carry the **Royal Constructions** brand: a warm gold, not Site Teal. This is deliberate and permanent. The operational core of the app (dashboard, projects, tradies, financials, milestones) runs on Site Teal as its action signal; the lead-management and sales-facing surfaces run on Royal Gold. The two never appear as competing primaries on the same screen because they live on different surfaces.

- **Royal Gold** (oklch(0.694 0.12 77.3)): Primary action and selection colour on leads/sales surfaces. The leads equivalent of Site Teal. Buttons, active pipeline stages, focus rings, links.
- **Royal Gold Dark** (oklch(0.609 0.106 77.7)): Hover/pressed state for gold actions.
- **Royal Gold Light** (oklch(0.947 0.029 89.6)): Tinted gold backgrounds, selected-row fills, soft highlights.
- **Royal Orange** (oklch(0.68 0.172 51.9)): Warm secondary energy on sales surfaces. Accent chips, time-pressure cues. The sales-surface cousin of Tradie Amber.
- **Royal Orange Light** (oklch(0.969 0.028 79.5)): Tinted orange backgrounds.

These are real `:root` tokens (`--royal-gold`, `--royal-gold-dark`, `--royal-gold-light`, `--royal-orange`, `--royal-orange-light`). The `.leads-container` CSS aliases them through its `--leads-*` variables; it no longer defines its own colour values.

### Semantic Status

A shared status scale, available app-wide as `:root` tokens, each with a tinted `-light` companion for backgrounds:

- **Success** (oklch(0.627 0.17 149.2)) / `--success-light`: completed, confirmed, healthy.
- **Warning** (oklch(0.769 0.165 70.1)) / `--warning-light`: caution, pending attention.
- **Info** (oklch(0.546 0.215 262.9)) / `--info-light`: neutral informational state.
- **Accent Purple** (oklch(0.541 0.247 293)) / `--accent-purple-light`: categorical/secondary tagging only, never an action colour.
- Destructive reuses **Site Red** (`--destructive`) with `--destructive-light` for tinted error backgrounds.

Status is always paired with a label or icon, never colour alone.

### Named Rules
**The One Signal Rule.** Each surface has exactly one action colour, used for interactive affordances only: it means "you can act here" or "this is selected." On the operational core that colour is Site Teal; on leads/sales surfaces it is Royal Gold. Using the action colour decoratively, on static backgrounds or ornamental borders, erodes the signal. Never mix teal and gold as competing primaries on the same surface. When in doubt, keep it neutral.

**The Amber-Not-Orange Rule.** The warm secondary is Tradie Amber (oklch(0.726 0.165 54.6) / chart-3), not an arbitrary orange. The body background gradient uses `rgba(232, 115, 12, 0.08)` which maps to this anchor. Keep warm secondary choices within this OKLCH family.

**The Light Canvas Rule.** The app background is always Slate Veil. Dark backgrounds are prohibited on content surfaces. The sidebar rail is structural chrome, not a content surface, and is the only exception. Do not introduce dark-themed sections, panels, or feature areas that break the light-canvas system.

## 3. Typography

**Display Font:** Fraunces (variable optical serif, Georgia, serif fallback)
**Body Font:** Manrope (humanist geometric sans-serif)
**Mono Font:** IBM Plex Mono (weights 400, 500)

**Character:** Fraunces brings editorial authority without formality — a typeface with opinions that commands attention at section level without shouting. Manrope is the professional who gets things done: clean, legible at small sizes, slightly warm. IBM Plex Mono is the data layer: unambiguous, grid-aligned, instantly readable as a number or code. The three voices never compete because their roles are distinct.

### Hierarchy
- **Display** (Fraunces, 600, clamp(2rem, 5vw, 3.5rem), lh 1.1, ls -0.02em): Page-level KPI values, hero numbers, editorial moments. High impact, used deliberately.
- **Headline** (Fraunces, 600, 1.75rem, lh 1.2, ls -0.015em): Section headings, milestone titles, feature page anchors, any header where editorial weight helps the user orient. More broadly used than Display, but still intentional.
- **Title** (Manrope, 600, 1.25rem, lh 1.3, ls -0.01em): Subsection headers, card titles (text-xl font-semibold in SectionCard). Operational, not editorial.
- **Body** (Manrope, 400, 0.875rem, lh 1.6): Descriptive copy, table cell content, form text, instructions. Max line length 68ch.
- **Label** (Manrope, 500, 0.75rem, lh 1.5, ls 0.02em): UI labels, column headers, status chips, CardDescription. Uppercase where structural (table headers); sentence case elsewhere.
- **Mono** (IBM Plex Mono, 400/500, 0.8125rem, lh 1.5): Project IDs, timestamps, phone numbers, reference codes, financial figures in dense tables. Never for headings or nav.

### Named Rules
**The Fraunces Gate.** Fraunces (`--font-heading`) is used wherever content needs editorial weight: KPI values, milestone titles, section headings, page anchors, and any moment where the user needs to feel the authority of what they're reading. The gate is Manrope territory: nav items, form labels, table cells, button copy, running instructions, any copy that is operational rather than authoritative. If it guides a user through a workflow, it's Manrope. If it commands their attention at a section level, it can be Fraunces.

**The Mono Precision Rule.** IBM Plex Mono appears only where ambiguity is dangerous: financial figures, date strings, IDs, phone numbers, codes. It signals "this is a fact, not a label." Using it for stylistic reasons breaks the signal.

## 4. Elevation

Structural layering. Three defined planes, each with a consistent shadow assignment. The system does not use flat-only or shadows-everywhere; shadows encode the layer stack so users always know where they are.

| Layer | Surface | Shadow |
|---|---|---|
| Ground | App background (`--background`) | None |
| Raised | Cards, section panels, table containers | `shadow-sm` always |
| Floating | Modals, drawers, popovers, toasts | `shadow-lg` (toasts: `0 24px 56px -28px rgba(15,23,42,0.32)`) |

The sidebar is structural chrome, outside the layering stack. It uses its own dark token (`sidebar-void`) and needs no shadow.

### Named Rules
**The Three-Layer Rule.** BuildPro uses exactly three elevation planes. Do not introduce intermediate layers (shadow-md on content cards, shadow-xl on sub-modals). Every surface belongs to Ground, Raised, or Floating.

**The Flat-at-Rest Rule.** Cards do not acquire additional shadow on hover. Hover state is expressed through `bg-muted/40` background tints or border-colour shifts, not shadow amplification. Shadow signals layer, not interactivity.

## 5. Components

### Buttons

Confident and direct. No ambiguity about what is clickable.

- **Shape:** Sharply rounded (0.5rem, `--radius-lg`). Substantial but not pill-shaped.
- **Primary:** Site Teal background (`--primary`), white foreground. Padding 10px 20px. Manrope 500, 0.875rem.
- **Hover / Focus:** Subtle darken on hover. Focus ring: `outline-ring/50` using the ring token (site-teal at 50% opacity), 2px offset.
- **Ghost:** Transparent background, night-slate text. Border appears on hover only.
- **Destructive:** Site Red background. Reserved for irreversible actions only.

### Metric Cards

The KPI summary pattern. Four across the top of dashboard-style pages.

- **Surface:** Card White, `shadow-sm`, `border-border/70`.
- **Icon container:** 44×44px, `rounded-2xl` (0.9rem). Tonal colours: teal (primary), orange (accent), emerald (success), amber (warning), red (danger).
- **Value:** Fraunces at display or headline scale, `text-3xl font-semibold tracking-tight`. Night Slate.
- **Label:** CardDescription, Manrope body, mid-slate.
- **Supporting note:** `text-sm text-muted-foreground` below the value.

### Section Cards

The standard content panel. Wraps most feature-level content.

- **Surface:** `bg-white/95`, `shadow-sm`, `border-border/70`.
- **Header:** `border-b border-border/70`, `pb-4`. Title at `text-xl font-semibold` (Manrope title scale) or Fraunces headline scale for pages that benefit from editorial weight. Optional description. Optional right-aligned action slot.
- **Body:** `pt-5`. Feature code owns internal layout; the card does not impose padding on its children.

### Inputs / Fields

- **Style:** `border border-input` (cool-border), `bg-background` or `bg-white/95`. Radius `--radius-md` (~0.425rem).
- **Focus:** Border shifts to `--ring` (site-teal); `outline-ring/50` glow.
- **Error:** Border shifts to `--destructive`. Error text at label scale, site-red, below the field.
- **Disabled:** 50% opacity. No other treatment.

### Navigation (Sidebar)

- **Rail:** Sidebar Void (`oklch(0.16 0.03 249.8)`), full-height, ~240px wide on desktop. This is the one dark surface in the system and it is structural, not a content area.
- **Default item:** Sidebar Foreground text, Manrope 500, 0.875rem. Transparent background.
- **Hover:** Sidebar Hover background (`oklch(0.221 0.03 250.1)`), `rounded-md`.
- **Active:** Site Teal background, Sidebar Primary Foreground text. The one bright element in the dark rail.
- **Mobile:** Rail hidden. Sheet-based or top-header navigation.

### Status Chips / Badges

- **Shape:** Rounded pill (`rounded-full`) for status badges; `rounded-md` for stage labels in tables.
- **Pattern:** 8% opacity tinted background of the status colour, full-saturation matching text. Example: success = emerald bg/8 + emerald-600 text.
- **Scale:** Label size (0.75rem, Manrope 500, slight letter-spacing).

## 6. Do's and Don'ts

### Do:
- **Do** use Fraunces for KPI values, section headings, milestone titles, page anchors, and anywhere editorial gravity helps the user orient.
- **Do** use IBM Plex Mono for all financial figures, project IDs, timestamps, and reference codes.
- **Do** apply `rounded-2xl` (0.9rem) to icon containers, avatar shapes, and interactive targets that benefit from a softer shape.
- **Do** assign `shadow-sm` to all raised card surfaces and `shadow-lg` to all floating surfaces, consistently and always.
- **Do** use `border-border/70` and `bg-white/95` on cards to maintain translucency against the body gradient.
- **Do** express hover states on list items and cards through background tints (`bg-muted/40`), not shadow amplification.
- **Do** keep Site Teal exclusive to interactive affordances: buttons, focus rings, active nav items, selected chips.
- **Do** carry Tradie Amber through chart data, warning icon containers, and time-pressure indicators.
- **Do** treat the light canvas as a permanent commitment. The sidebar dark rail provides structural contrast; it is not an invitation to introduce dark content surfaces.

### Don't:
- **Don't** make it look like Asana or Monday.com: no pastel card grids, no bouncy transitions, no startup-template layouts.
- **Don't** make it look like Procore or BuilderTrend: no dense grey utilitarian chrome, no enterprise-2015 typography.
- **Don't** make it look like a finance or banking dark-mode product: no terminal-native aesthetics, no neon accents, no dark content surfaces, no crypto-adjacent chrome. BuildPro runs in daylight. Precision is correct; that aesthetic register is wrong.
- **Don't** introduce dark-themed panels, sections, or feature areas outside the sidebar rail. The light canvas is not a default that gets overridden; it is the system.
- **Don't** use Inter. Manrope is the only body/UI font (`var(--font-sans)`). The `.leads-container` Inter usage has been removed; do not reintroduce it.
- **Don't** give the `.leads-container` CSS its own colour, font, or radius values. The parallel token set has been dissolved: `--leads-*` now alias the canonical `:root` tokens (`--royal-gold`, `--success`, `--foreground`, etc.), radii alias the global radius scale, and `font-family` inherits Manrope. Keep it that way. Prefer Tailwind utility classes over extending this hand-written CSS block at all; new sales/leads UI should consume the system tokens directly. (Shadow values in the block remain bespoke px values, pending a future pass onto the token scale.)
- **Don't** use `border-left` wider than 1px as a coloured accent stripe on cards, list items, or callouts. The follow-up notes block has one; it is the pattern to eliminate, not repeat.
- **Don't** use gradient text (`background-clip: text` combined with a gradient background). No exceptions.
- **Don't** introduce identical card grids: same-sized cards with icon + heading + body text, repeated. MetricCard is a purposeful exception with strict data binding. Generic icon grids are prohibited.
- **Don't** use glassmorphism decoratively. Backdrop blur belongs on modal backdrops. It should not appear on cards, panels, or navigation elements.
