---
name: Royal Constructions
description: Operations software for a residential builder, in the Royal Constructions brand
colors:
  royal-gold: "#c6923a"
  royal-gold-ink: "#926100"
  royal-gold-ink-hover: "#7f4f00"
  royal-gold-light: "#f6ebd6"
  royal-gold-wash: "#fbf6ec"
  cream-canvas: "#f7f6f2"
  card-white: "#ffffff"
  surface-sunk: "#f1efe9"
  row-hover: "#f4f1ea"
  ink: "#2b2a27"
  ink-2: "#4a4741"
  muted: "#6b675f"
  subtle: "#8c877d"
  hairline: "#e6e2d9"
  border-strong: "#d3cec3"
  rail-charcoal: "#262523"
  rail-hover: "#33312e"
  rail-text: "#d9d5cc"
  rail-muted: "#9c978c"
  ok: "#1e7a45"
  ok-bg: "#e6f4ec"
  warn: "#b54708"
  warn-bg: "#fef0e2"
  danger: "#ac0f0f"
  danger-bg: "#fbeaea"
  info: "#2456a6"
  info-bg: "#e8effa"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  section:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  mono:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  booking-heading:
    fontFamily: "IBM Plex Sans Condensed, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "11px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.royal-gold-ink}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  list-row:
    minHeight: "40px"
    padding: "6px 16px"
    borderTop: "1px solid {colors.hairline}"
  kpi-band:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.lg}"
    columns: 4
  sidebar:
    backgroundColor: "{colors.rail-charcoal}"
    textColor: "{colors.rail-text}"
    width: "232px"
  sidebar-item-active:
    backgroundColor: "{colors.rail-hover}"
    indicator: "3px {colors.royal-gold} bar on the left edge"
---

# Design System: Royal Constructions

> **The one design document.** It is both the visual direction and the guide to
> building UI here (§10). It replaces `docs/design.md`, which described the
> retired teal theme. The app moved to this system in PR #525 (17 Nov 2026).
> When this file and the code disagree, this file is the intent and the code is
> the debt. A static page-by-page demo exists but stays out of the repo for now,
> because it shows real client names.

## 1. Overview

**Creative North Star: "The Site Office, in our own colours"**

Royal Constructions builds homes in south-west Sydney. The software is the
office: leads on the desk, offers going out, builds on the wall, tradies on the
phone. It should feel like the company's own tool. It should not look like a
generic SaaS product with a builder's logo pasted on top. So it takes the
brand straight from
[royalconstructions.com.au](https://royalconstructions.com.au): **Royal Gold
`#C6923A`, charcoal `#343434`, warm cream `#F7F6F2`.**

Who uses it: two or three office staff on a shared admin login, between site
visits, on a laptop or a phone. Clients never see the app. They see what it
sends out: emails, the offer PDF, DocuSign envelopes, the public booking page.
Those outputs carry the brand most strictly, because a wrong number or a
cheap-looking page in front of a homeowner is the expensive kind of mistake.

**What it looks like:** a light, warm canvas. One charcoal navigation rail.
White cards with a hairline shadow. One gold action colour. Dense single-line
lists. Numbers in mono. Every screen gives its visual weight to the data.

**What it rejects:**
- Generic SaaS like Asana or Monday: pastel cards, bouncy motion, icon-tile grids.
- Old construction software like Procore or BuilderTrend: grey enterprise chrome.
- Dark finance and crypto UIs: neon on black.

**References:** Linear (lists, grouping, density), Stripe Dashboard (record
pages, money, invoices), Attio (CRM record layout), Calendly (booking).
Mobbin screens for each page are listed in §7.

## 2. Colour

### Brand
- **Royal Gold `#c6923a`** is a *fill*, not a text colour. It goes on the rail's active-item bar, the brand mark, chart series 1, progress bars and the timeline's "current" dot. White text on it is only 2.77:1, so it never carries white text. Dark ink on it is 5.18:1 and is allowed for small badges.
- **Royal Gold Ink `#926100`** is gold as something you *act on or read*: primary button fill (white 5.34:1), links, focus rings, the active label in segmented controls. Hover is **`#7f4f00`** (white 6.95:1). These are the app's existing contrast-tested `--royal-gold-ink` oklch(0.53 0.12 77.3) and `--royal-gold-ink-hover` oklch(0.47 0.12 77.3), written as hex. They are not new values.
- **Gold Light `#f6ebd6`** is for selected rows, active chips and gold status pills (gold-ink on it 4.52:1). **Gold Wash `#fbf6ec`** is the quietest gold tint, used for notice strips.

### Warm neutrals
These are re-derived on the brand's warm hue, so the cream canvas and the
charcoal rail do not clash with cool blue-grey borders.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| cream-canvas | `#f7f6f2` | App background | — |
| card-white | `#ffffff` | Cards, lists, popovers | — |
| surface-sunk | `#f1efe9` | Group headers, table heads, inset wells | — |
| row-hover | `#f4f1ea` | Row and ghost-button hover | — |
| ink | `#2b2a27` | Body text | 13.3:1 on canvas |
| ink-2 | `#4a4741` | Secondary text | — |
| muted | `#6b675f` | Labels, metadata | 5.2:1 on canvas |
| subtle | `#8c877d` | Icons, placeholders, disabled. **Not body text** | 3.6:1 |
| hairline | `#e6e2d9` | Row dividers, card heads | — |
| border-strong | `#d3cec3` | Inputs, secondary buttons | — |
| rail-charcoal | `#262523` | Sidebar | rail-text 10.5:1 |

### Status
Status is **always a tint plus a text label**, never colour alone.

| Status | Text | Background | Means |
|---|---|---|---|
| ok | `#1e7a45` | `#e6f4ec` | Done, confirmed, signed, Converted |
| warn | `#b54708` | `#fef0e2` | Overdue, awaiting approval, needs attention |
| danger | `#ac0f0f` | `#fbeaea` | Declined, lost, cancelled, destructive actions (site red) |
| info | `#2456a6` | `#e8effa` | Sent, in review, informational |
| neutral | `ink-2` | `#efece5` | Draft, pending, archived |
| gold | `gold-ink` | `gold-light` | Active sales stage (Negotiating, Tender sent) |

### Named rules
**The One Gold Rule.** Gold is the only action colour, on every page. Teal is retired. One primary (gold-ink) button per view. Gold never decorates: no gold borders on static cards, no gold headings, no gold gradients.

**The Warning-Is-Orange Rule.** Warnings use `#b54708` (orange-brown) plus an icon or a text label, so a warning never reads as a gold button.

**The Light Canvas Rule.** The cream canvas is permanent and there is no dark mode. The charcoal rail is the only dark surface, and it is structure, not content. The `/guest` page's dark gradient goes.

## 3. Typography

The app keeps its three voices. The website uses Belleza and Raleway. Both
are too airy for dense tables, so the app does not use them. Belleza is an
option for the brand mark only, if the owner wants it.

- **Fraunces** (600): page titles (26px), section titles (17px), headline KPI counts. Never in nav, buttons, table cells or form labels.
- **Manrope** (400/500/600): everything operational. 14px body, 13px controls, 11px uppercase labels.
- **IBM Plex Mono** (400/500): money, dates, reference codes (`RC-Q-…`), phone numbers, durations. **Not for counts.** Counts use Manrope with tabular figures.
- **IBM Plex Sans Condensed** (600): the public booking page heading only. The size comes down from 42px to 28px (owner decision, 16 Nov 2026). Its uppercase condensed style stays.

**The Fraunces Gate.** If the text guides someone through a task, it is Manrope. If it names the page or a section, it may be Fraunces.

**The Mono Precision Rule.** Mono means "this is an exact fact": money, dates, IDs, phones. It is never used for style.

## 4. Layout and elevation

- **Shell:** a 232px charcoal rail with the brand mark and nav (Dashboard, Leads, Offers, Operations Agent, Projects, Tradie Management, Admin). The top bar shows breadcrumbs and Sydney time. Every crumb but the last is a link (`getShellTrail` in `utils/shell-nav.ts`). The top bar is the one frosted-glass surface: the page scrolls under it. Below 760px the rail becomes a slide-over sheet.
- **Page header:** one Fraunces title, a one-line count or status beneath it, one primary action on the right. No hero cards, gradients or decorative circles.
- **Three planes only:** canvas (flat), raised (cards and lists, `shadow-sm`), floating (modals, drawers, toasts, `shadow-lg`). **Flat at rest:** hover is a background tint, never a lift or a bigger shadow.
- **Radii:** 4px for tags, 8px for controls, 11px for cards, pill for status.
- **Width:** content maxes at 1360px. Gutter is 24px, or 16px on phones. No horizontal page scroll; wide tables scroll inside their card.

## 5. Components

### The one list (every index page)
Reference: [Linear grouped list](https://mobbin.com/screens/be6c4ee4-aa93-42b4-89b3-dcfc8386f022).
- Group headers on `surface-sunk`, with the name, a count, and optionally a summed value on the right in mono. Headers stick under the top bar.
- Rows are single-line, at least 40px, with a hairline between them. The primary text is 600 weight, metadata is muted, and dates and money are right-aligned in mono.
- Hover is `row-hover` and a selected row is `gold-light`. The whole row is the link.
- On phones, columns marked `hide-sm` drop out. Rows never wrap into cards.

### List pages, as built
Every index page has the Leads list's shape, from shared parts in
`components/common/list-toolbar.tsx` and `components/ui/table-styles.ts`:
`PageHeader`, then a `KpiBand`, then one `ListToolbar` (view tabs on the left;
sort, filter selects, `ToolbarSearch` and Export on the right), then one
`TableCard` holding chips in its header and a `flush` table. A section-level
list (a detail tab, a dashboard widget) is one `TableCard` whose header holds
the title and the same controls. **Never put a card around a `TableCard`.**
Tables take their header, row and cell classes from `table-styles.ts`, so
every table matches. Grouping rows by stage or status is still the target
above; most lists are not grouped yet.

### KPI band
3–4 figures in one white band divided by hairlines, each with a label, a value and an optional delta chip. This **replaces** the grids of coloured icon tiles. Money values use mono and counts use Fraunces. In code: `KpiBand` and its cell classes in `components/common/kpi-band.tsx`. A figure that filters the list is a toggle button with `aria-pressed`; the active one gets a gold-light fill and a gold bar along its foot.

### Record page (lead, offer, project, tradie)
A record header (name, status pill, key attributes inline) above two columns.
The main column holds sections, tabs and the activity timeline. A **right
rail** (320px, sticky) holds labelled key-value facts and the next action.
References: [Attio](https://mobbin.com/screens/297adfeb-8312-496b-8acf-41839a6cf775), [Stripe](https://mobbin.com/screens/1a4aa88b-e0be-49b2-a87f-1264e0b5e786).

### Buttons
- **Primary:** gold-ink with white text, 34px high, radius 8.
- **Secondary:** white with a strong border.
- **Ghost:** transparent, `row-hover` on hover.
- **Danger:** site red. Only for irreversible actions.

### Tabs and segmented controls
- **Tabs:** muted labels, and the active tab gets ink text with a **2px gold underline**. Five tabs at most. A count, if shown, is Manrope with tabular figures.
- **Segmented:** the active segment is `gold-light` with gold-ink text.

### Status pill
22px high, a pill shape, a tint plus a 6px dot plus a text label. The labels come from the app's own maps (`lib/leads/pipeline-stages.ts`, `OFFER_STATUS_LABEL`). **Converted is never shown as "Won".**

### Timeline
A 1px rail with a dot per event. Done is ok-green, current is gold, needs attention is warn, upcoming is hollow. Dates are in mono and date headers group events by day.

### Forms
- Labels sit above fields in 13px/600. Hints go under the field in muted text.
- Fields have a strong border and a gold-ink focus ring.
- Long forms get a **sticky save bar**, and ordered lists get **grip handles**.

### Notices
- **Warn strip:** an icon plus a sentence, on warn-bg.
- **Gold wash:** for "your move" prompts such as an approval waiting above the agent's message box. No loud gold panels.

### Client documents (emails, offer PDF, DocuSign)
These leave the building, so they follow the brand most strictly.
- **Colour:** charcoal text (`#343434`) on white. Gold `#c6923a` only for the logo, a thin rule under the letterhead, and table header underlines. Gold-ink `#926100` for links. No other colours, except a status word where one is needed.
- **Type:** email clients and PDF renderers may not load web fonts. Body uses `Manrope, "Segoe UI", Helvetica, Arial, sans-serif`. Headings use `Georgia, "Times New Roman", serif` as the Fraunces fallback. Money uses `"IBM Plex Mono", Menlo, Consolas, monospace`, or tabular figures in the body face where mono isn't available.
- **Money:** always AUD, always labelled `inc GST` or `ex GST`. State the contract price once, inc GST. The payment-schedule amounts must add up to it.
- **Dates:** written as `16 November 2026`, with Sydney time wherever a time is shown.
- **Never:** internal IDs, staff-only notes, or placeholder text.

## 6. Motion
Motion is purposeful only: around 150ms colour and background transitions, and the mobile sheet slide. There is no hover lift, translate or glow, no bouncing, and no skeleton that runs longer than the data takes. `prefers-reduced-motion` turns transitions off.

## 7. Page patterns
Every link below is a real Mobbin screen (verified 16 Nov 2026). Use the
**pattern**, not the source app's colours.

| Page | Pattern | Mobbin references |
|---|---|---|
| **Dashboard** `/dashboard` | A "Needs attention today" list first: overdue and due follow-ups, approvals waiting, offers out for signature. Each group shows at most 3 rows plus "View all N", so the KPI band stays above the fold. Then a 4-figure KPI band, then pipeline by stage, then active builds. *Proposed, owner to confirm:* drop the site-manager table, because nobody holds the role yet. | [Linear](https://mobbin.com/screens/610d34b6-6ad8-45ab-80fb-2107b31ed01e), [Stripe](https://mobbin.com/screens/de7497ad-db87-4d21-a3a8-825f9207c7d4), [Fresha](https://mobbin.com/screens/510e25d1-0df7-4fbe-aaae-cdd959473efb) |
| **Leads** `/leads` | List grouped by stage, with count and summed budget per group. A one-row toolbar with search, stage, source and List/Board. No gradient hero. | [Linear](https://mobbin.com/screens/be6c4ee4-aa93-42b4-89b3-dcfc8386f022), [Pipedrive](https://mobbin.com/screens/fa0efe82-ea90-4864-ae99-ca3dd822c77b) |
| **Lead detail** `/leads/[id]` | Record header with stage, budget and next follow-up. The main column holds the activity timeline grouped by day. The right rail holds contact facts and open tasks, overdue first. | [Attio](https://mobbin.com/screens/297adfeb-8312-496b-8acf-41839a6cf775), [Apollo](https://mobbin.com/screens/0c8b1452-13a4-420f-ae00-ec8d6ff2c897) |
| **Offers** `/offers` | List grouped by status (Pending, Sent, Tender sent, Contract, Project), with the reference in mono and the inc-GST total right-aligned. | [Linear](https://mobbin.com/screens/be6c4ee4-aa93-42b4-89b3-dcfc8386f022) |
| **Offer workbench** `/offers/[leadId]` | Built like an invoice. The header shows the reference, status and client. The main column holds the cost schedule by stage, the totals block and the payment schedule. The right rail holds the contract price, signers in order, and send/sign events. | [Stripe](https://mobbin.com/screens/6d5a72ea-9800-4749-bfd8-4fa4a3a838bd), [Square](https://mobbin.com/screens/84f13f8a-fd51-4e0b-b151-ad27d420bffa), [Contractbook](https://mobbin.com/screens/d86c7d8a-e51b-4dd7-87a6-2a9f7c65c7f8) |
| **Projects** `/projects` | List grouped by status, with budget and dates in mono. No coloured top stripes and no uniform card grid. | [Linear](https://mobbin.com/screens/be6c4ee4-aa93-42b4-89b3-dcfc8386f022) |
| **Project detail** `/projects/[id]` | The main column holds a milestone timeline grouped by build stage (Deposit, Slab, Frame…), then tradie bookings. The right rail holds properties, budget and progress. The schedule is a tradie-by-day grid with neutral blocks and a warn flag only for conflicts or approvals. | [Linear](https://mobbin.com/screens/74320f37-d2e8-4646-ae43-9235f2f30399), [Upwork](https://mobbin.com/screens/852b67eb-ff9d-4033-a119-222c98bed469), [Deputy](https://mobbin.com/screens/d653e9fc-79e5-4a3f-90e6-1e2b6a22adf5) |
| **Tradies** `/tradie-management` | A left filter column (search, trade, favourites) beside a list grouped by trade. | [Glassdoor](https://mobbin.com/screens/e2e4cb3c-ac40-4dbc-9d07-2fa99d3bfcd5) |
| **Tradie profile** `/tradie-management/[id]` | Fact fields grouped under small uppercase headings (Contact, Work, System), with tabs capped at five. | [Attio](https://mobbin.com/screens/f5a0eb36-47fe-4f4d-9bd6-d4d1b11a8ef5), [Twenty](https://mobbin.com/screens/9393b3fd-e5f3-40d3-87fd-dcfa9b4b3a66) |
| **Operations Agent** `/agent` | A session list beside the transcript. Tool calls are compact rows that expand on click. Approvals sit in a gold-wash strip above the message box with two labelled choices. There are no raw IDs anywhere. | [Chatbase](https://mobbin.com/screens/b7ee8823-3fde-42ea-b0b4-26053b62cde4), [Zapier](https://mobbin.com/screens/cb65c41e-e7b6-4bd9-af40-cd92d768e90d), [Linear](https://mobbin.com/screens/9ec39891-cdbb-4d57-b0c6-de43f82c5f4e) |
| **Admin** `/admin/*` | The hub is a list of tools with their status, not 8 tiles. The approvals queue is a table with a menu on each row. Team is a single table with an invite row. Build sequence and trade types use reorder lists with grips and a sticky save bar. | [Remote](https://mobbin.com/screens/68c88a4c-0241-4007-928d-41f2a85f311f), [Rows](https://mobbin.com/screens/8808750f-9991-4817-95d1-8eafcc747f7e), [Fresha](https://mobbin.com/screens/c303fa1c-01df-4330-b5bd-f6db02b9371b) |
| **Book consultation** (public) | A summary rail on the left (service, length, venue, chosen slot), then a calendar, then a column of time slots. Gold marks the selection. The condensed heading is 28px. | [Calendly](https://mobbin.com/screens/57876292-340c-408a-9563-fe0ab9f5dcbd), [Jobber](https://mobbin.com/screens/10811e3a-9605-4105-9600-6eca7c27b79c) |
| **Sign-in / Guest** | One plain centred card on cream, with no gradient. Guest shows a status timeline (Submitted, In review, Approved). | [Stripe](https://mobbin.com/screens/46b46f0f-6cb5-4f1e-85a3-bb0606894379), [Mercury](https://mobbin.com/screens/c9e6999a-303b-4026-89f5-0d64934f9ab4) |

## 8. Do's and don'ts

**Do**
- Do use one primary gold-ink action per view.
- Do use the one list component for every index page, grouped and counted.
- Do show money as AUD with `inc GST` / `ex GST` stated wherever a client could see the number.
- Do show dates in Sydney time.
- Do hide a control that doesn't work yet. A search box wired to `console.log` looks live and is not.
- Do give icon-only buttons an `aria-label`. Keep focus rings visible.

**Don't**
- Don't use teal anywhere. It is retired.
- Don't add gradient heroes, coloured top stripes, icon-tile grids, hover lift or corner glows.
- Don't put white text on base gold, or use base gold as text on cream.
- Don't add dark panels or a dark mode.
- Don't use mono for counts, or Fraunces in tables, nav or buttons.
- Don't show mock data on an operational screen. *Proposed, owner to confirm:* remove the dashboard's `siteManagersMock` table.
- Don't put a coloured `border-left` stripe wider than 1px on cards or callouts. Don't use gradient text or Inter. Glass is allowed in one place only: the app's top bar, frosted over the page scrolling under it (owner, 17 Nov 2026). Nowhere else: no glass cards, panels, dialogs or overlays.

## 9. Decisions

**Decisions (owner, 16 Nov 2026)**
1. Royal Gold is the accent for the **whole app**, not only sales surfaces. Teal (`--primary`, `--ring`, `--sidebar-primary`, `--chart-1`) is retired. That includes Clerk's primary colour on sign-in and sign-up.
2. Colours follow royalconstructions.com.au: gold `#C6923A`, charcoal, cream. The navy rail becomes charcoal and the cool slate neutrals become warm.
3. The booking page heading comes down to 28px and keeps its condensed uppercase style.
4. Mobbin page patterns (§7) are the reference for each page.
5. Glass is allowed in the top bar only (owner, 17 Nov 2026).

**Done (PR #525, 17 Nov 2026):** the tokens in `app/globals.css` (names kept,
values swapped, pinned by `tests/design/brand-contrast.test.ts`), the page
header, the KPI band, the shared list toolbar and table styles, every page
moved to them, and `docs/design.md` folded into this file.

**Still open:** grouped lists (§5), the record-page right rail, and the
dashboard's `siteManagersMock` table (§8, owner to confirm).

## 10. Building UI in this repo

### Shared parts
Compose these before writing new UI. They are thin: they fix layout and tone,
not feature behaviour.

| Part | Use |
| --- | --- |
| `components/common/app-shell.tsx` | The rail, the glass top bar, breadcrumbs, page framing |
| `components/common/page-header.tsx` | Page title, its one-line count, the primary action |
| `components/common/kpi-band.tsx` | A row of figures (§5 KPI band) |
| `components/common/list-toolbar.tsx` | `ListToolbar`, `ToolbarSearch`, `FilterChips`, `TableCard`, view-tab classes |
| `components/ui/table-styles.ts` | The one table look: head, row, cell, flush card |
| `components/common/data-table.tsx` | A table with loading and empty states; `flush` inside a `TableCard` |
| `components/common/section-card.tsx` | A titled content panel on a record page |
| `components/common/status-pill.tsx` | Status: a tint, a dot and a label |
| `components/ui/*` | shadcn primitives: button, card, dialog, sheet, tabs, input, select |

### Styling
- Tailwind utilities on the CSS variables in `app/globals.css`, mapped through `@theme inline`. No hex in feature code, and never a second token set inside a feature folder.
- Compose classes with `cn()`. It runs tailwind-merge, which drops a `leading-*` placed before a font-size class: write `text-sm/[1.4]` instead.
- A file that a server `loading.tsx` imports takes no `"use client"`: `kpi-band.tsx`, `list-toolbar.tsx` and `table-styles.ts` are kept server-safe for that reason.

### Modals
Global modal state lives in `components/modals/modal-manager.tsx`. The body of
each modal lives in its feature folder. Keep the open state in Redux or the
feature's slice, and make destructive or status-changing actions plain in both
the copy and the button.

### Forms
React Hook Form with Zod, on the shadcn inputs. Labels above fields, the error
beside the field that failed, a submit button that shows it is working. A
required field says so: a red `*` with a screen-reader "required", plus
`required` and `aria-required` on the control.

### Loading, empty and error states
- Each route has a `loading.tsx` whose skeleton has the page's real shape, built from the same server-safe parts.
- An empty state says what is missing and offers the next step or a reset.
- An error state is short, in plain words, with a retry where a retry can help.

### Toasts and notifications
Sonner, mounted in `app/layout.tsx` and themed in `app/globals.css`. Keep
toasts short and operational. A partial success says how many went through
and why the rest did not; a success toast never covers a failure. The bell in
the top bar is a light in-app feed, not a notification centre.

### Accessibility
- Icon-only buttons have an `aria-label`. Focus rings stay visible.
- Status is never colour alone: always a text label.
- A toggle (a filter chip, a filtering KPI) sets `aria-pressed`.
- Breadcrumbs are a `<nav aria-label="Breadcrumb">` list.
- Dialogs and sheets keep keyboard navigation and close on Escape.
