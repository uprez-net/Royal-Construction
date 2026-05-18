# Design

This document describes the UI and UX system used in the repository today. It focuses on the actual implementation rather than a generic design-system theory.

## Design Philosophy

The interface is built for an operations-heavy construction management product. The visual language is intentionally dense, information-forward, and dashboard-oriented rather than marketing-driven.

The current aesthetic uses:

- dark shell chrome for navigation and account context
- bright card surfaces for work areas
- teal as the primary action color
- orange and amber for secondary emphasis and warnings
- slate-based neutrals for structure and hierarchy

The result is a warm industrial admin UI, not a minimalist SaaS shell.

## Typography

The root layout in [app/layout.tsx](../app/layout.tsx) loads three fonts through `next/font/google`:

- Manrope for body copy and general interface text
- Fraunces for the brand and headline treatment
- IBM Plex Mono for monospace accents

These fonts are wired into CSS variables in [app/globals.css](../app/globals.css) and exposed through Tailwind theme tokens.

Guidance:

- use the heading font only when the layout needs brand weight or a more editorial feel
- keep body text in the sans font family
- reserve the mono font for timestamps, IDs, or operational metadata

## Color System

The main token set is defined in [app/globals.css](../app/globals.css).

### Core palette

- background and surfaces use light slate and near-white values in the base theme
- primary actions use teal
- warnings lean amber or orange
- destructive states use red
- the sidebar uses a dark slate treatment with teal accents

### Theme implementation

The app uses CSS custom properties plus `@theme inline` to map design tokens into Tailwind classes. That gives the codebase a consistent palette while still allowing variants like dark mode and component-specific tone maps.

### Background treatment

The root layout and shell use layered radial gradients and a subtle grid texture. That visual treatment is part of the product identity and should be preserved when adding new pages.

## Layout Conventions

The default page pattern is:

- full-height shell
- narrow dark navigation rail on desktop
- sticky top header
- centered content area capped at `max-w-screen-2xl`
- card-based content sections with even spacing

The most common spacing pattern is a gap-based grid with 4, 6, or 8 unit spacing rather than deeply nested margin stacks.

### Responsive behavior

- the sidebar hides on small screens
- major dashboards collapse from multi-column grids into stacked sections
- cards and tables are wrapped in overflow-safe containers
- dense controls usually become stacked action rows on narrow widths

## Shared UI Architecture

The UI system is built from a small number of reusable surfaces.

| Component | Purpose |
| --- | --- |
| [components/common/app-shell.tsx](../components/common/app-shell.tsx) | Global navigation and page framing |
| [components/common/section-card.tsx](../components/common/section-card.tsx) | Standard content panel with header and optional actions |
| [components/common/metric-card.tsx](../components/common/metric-card.tsx) | KPI summary card |
| [components/common/data-table.tsx](../components/common/data-table.tsx) | Shared tabular display |
| [components/common/status-pill.tsx](../components/common/status-pill.tsx) | Status badge abstraction |

These abstractions are intentionally thin. They standardize layout and tone, but they do not hide feature-specific behavior.

## Component Composition Patterns

The dominant composition pattern is card stacking:

1. a feature page renders one or more summary cards
2. each section is wrapped in a card-like container
3. action buttons are placed in the header row of the card or shell
4. detail views use tab panels and nested cards for subordinate entities

This is visible in the dashboard, project detail, and tradie coordination screens.

## Styling Strategy

The codebase uses Tailwind CSS classes for most layout and component styling.

The CSS strategy is:

- Tailwind utilities for the majority of the UI
- CSS variables for theme tokens
- a small amount of global CSS for app-wide effects and toaster styling
- occasional component-local custom styling where the visual language is more specific

The shared primitive layer is built on shadcn-style components and class composition through `cn()`.

## Tailwind Usage Standards

Current good patterns:

- use token-backed utility classes instead of hardcoded colors when possible
- prefer `border-border/70`, `bg-muted/40`, and similar semantic token usage for surfaces
- use rounded-2xl or larger corners for card-like surfaces and controls
- keep icon buttons sized consistently, usually `size-10`

Avoid:

- ad hoc hex colors in feature code unless the screen truly needs an isolated identity
- deeply nested custom CSS when a utility class sequence will do
- creating a second design token system inside a feature folder

## Reusable UI Primitives

The shared primitives already present in the repository include standard button, card, badge, dialog, table, sheet, tab, input, and pagination building blocks under `components/ui`.

These should be the first choice for new UI. Feature code should compose them rather than reimplement them.

## Tables And Dashboard Patterns

Tables are used for list-heavy operational surfaces such as projects and quotations.

- rows are dense and hover-highlighted
- headers are uppercase and low-contrast
- the table wrapper has rounded borders and horizontal overflow handling
- row-level actions should remain explicit rather than hidden in obscure hover menus

Dashboards use:

- metric cards for top-level KPIs
- section cards for grouped content
- compact feeds or timeline-like lists for activity streams

## Modal And Dialog Patterns

The app uses a central modal manager in [components/modals/modal-manager.tsx](../components/modals/modal-manager.tsx).

This means modal state is global, but the content still lives in feature-specific modal components. That is the right shape for cross-page workflows such as project creation, update posting, or tradie scheduling.

Guidelines for new modals:

- keep the trigger state in Redux or the relevant feature slice
- keep the modal body in the feature folder, not in the coordinator
- always provide explicit open/close hooks
- make destructive or status-changing actions obvious in the copy and button styling

## Form Design Patterns

The repository already depends on React Hook Form, Zod, and shadcn input primitives.

The expected form style is:

- labeled inputs with clear helper text
- button placement at the bottom right of the form or modal
- error text close to the field that failed validation
- compact but readable spacing
- stateful submit buttons that reflect loading or pending status

## Loading, Empty, And Error States

The current patterns are pragmatic rather than overly animated.

- loading states often use short textual placeholders or simple blocks
- empty states use dashed borders, centered copy, and a clear retry or reset action
- error states are usually concise and red-tinted

There is not yet a unified skeleton system. If you add one, keep it subtle and data-dense rather than decorative.

## Toast And Notification Standards

Toasts are handled by Sonner and themed in [app/globals.css](../app/globals.css).

The toaster styling uses border, shadow, and semantic tone variants. New notifications should remain short and operational. Avoid verbose success copy.

The top-right notification dropdown in the shell is a lightweight in-app feed, not a full notifications center.

## Accessibility Considerations

The design system has a few important accessibility expectations:

- icon-only buttons need `aria-label`
- status should not be conveyed by color alone when the label can be explicit
- focus rings should remain visible through the shared `outline-ring/50` setup
- dark shell text needs careful contrast handling
- dialogs and drawers should preserve keyboard navigation and escape handling

## Existing Anti-Patterns In The UI Layer

The biggest visual inconsistency is the large leads-specific CSS block in [app/globals.css](../app/globals.css).

Problems with that block:

- it defines its own token set instead of using the shared theme tokens
- it hardcodes Inter instead of the project fonts
- it introduces a second visual language into the app
- it increases the maintenance cost of the global stylesheet

Other minor issues:

- some mock-driven screens still rely on hardcoded values instead of shared data shapes
- a few controls use visual emphasis without strong affordances for disabled or pending states

## How New UI Should Be Built

When adding a new UI surface:

1. start with shared tokens and shared primitives
2. build on `Card`, `Button`, `Badge`, `Dialog`, and the local feature shell pattern
3. keep the layout data-dense and operational
4. use the established teal/orange/slate palette unless the feature has a strong reason not to
5. add an empty state and a loading state at the same time as the primary UI

If a feature needs a new visual language, it should still map back to the shared token system instead of defining its own palette.
