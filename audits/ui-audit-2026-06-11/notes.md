# Royal Construction Lead Management UI Audit

Date: 2026-06-11
Scope: `/leads` authenticated Lead Pipeline flow on local dev server `http://localhost:3000`.
Capture tool: `agent-browser` against the running local Next.js app.
Destination: local folder `audits/ui-audit-2026-06-11/`.

## Screenshots

1. `01-leads-table-desktop.png` - desktop lead pipeline table state.
2. `02-lead-detail-modal.png` - lead detail edit modal.
3. `03-email-campaign-modal.png` - email campaign template chooser after data loaded.
4. `04-email-campaign-preview.png` - email campaign compose/preview step.
5. `05-followups-tab.png` - follow-up schedule tab.
6. `06-analytics-tab.png` - analytics tab.
7. `07-leads-mobile.png` - mobile first viewport.
8. `08-leads-mobile-table.png` - attempted lower mobile capture; page did not scroll.

## Step Health

1. Desktop lead table: Healthy foundation, but visually heavy. The hierarchy is clear and the KPI cards are readable, but the real work area starts far down the page and the table requires dense scanning.
2. Lead detail modal: Functional, but too tall and dense for repeated updates. Activity is pushed below the visible area, while the form fields and editor dominate the first view.
3. Email campaign template chooser: Useful template structure, but slow to settle and the template titles are truncated heavily.
4. Email campaign compose preview: Functional and informative, but the recipient textarea is overloaded and the bottom actions are partially clipped at the tested viewport.
5. Follow-ups tab: Visually cleaner than the table. The repeated Call/Email actions need more context for assistive tech and for fast scanning.
6. Analytics tab: Useful directionally, but chart content is cropped in the first viewport and chart semantics need more accessible summaries.
7. Mobile first viewport: Looks polished at the top, but the KPI stack consumes the screen before users reach the operational controls.
8. Mobile lower content: Poor. The document reported no page scroll at 390x844 even though content continues below the visible area. This makes the lower Lead Pipeline workflow effectively unreachable in the captured mobile state.

## Strengths

- The product has a coherent Royal Constructions visual language: gold brand, teal operational actions, light cards, and compact internal-tool density.
- The Lead Pipeline page communicates the main business concepts: captured leads, follow-up automation, email templates, conversion, pending follow-up, and lost leads.
- The follow-up tab is the clearest operational view because it groups reminders and quick actions around upcoming work.
- The email campaign flow now exposes per-lead personalization context and a preview, which is the right pattern for a high-risk bulk-send action.

## UX Risks

1. Mobile reachability is the highest-priority UI issue. `AppShell` uses an outer `overflow-hidden` wrapper and the `main` area is the actual scroll container. In the captured 390x844 state, `window.scrollY` stayed `0` and `document.documentElement.scrollHeight` equaled the viewport height, while visible content was cut off. Verify the `main` scroll container works on physical mobile; if not, move scrolling back to the document or make the shell/main height explicit.
2. The Lead Pipeline first viewport over-prioritizes summary cards. On desktop this is acceptable, but on mobile the hero plus KPI stack blocks the actual table/follow-up workflow. Collapse KPI cards into a horizontal strip, smaller metric row, or summary drawer on mobile.
3. The desktop table is dense and table-only. It works for scanning, but for CRM operations a compact split or card detail pattern would reduce row-click/modals for common updates.
4. The lead detail modal puts form editing before the activity timeline. For daily follow-up work, Activity, next action, and latest note should be visible earlier. Consider a two-column desktop modal with sticky actions and an Activity/Notes rail.
5. Email campaign compose uses a giant recipient textarea. This is hard to audit before sending. Replace it with a recipient count, filter summary, warning for invalid-looking entries, and a separate expandable recipient review.
6. Email campaign actions are partially clipped at the bottom in the captured viewport. Make the modal body scroll and keep Cancel/Send sticky in a visible footer.
7. Template chooser titles truncate too aggressively. Cards should show a stable title plus the personalized subject separately, or use a preview-on-select pane.
8. Analytics charts need stronger explanatory summaries. The chart visuals are present, but the first viewport crops them and does not explain what action the team should take.

## Accessibility Risks

1. Modal background content remains visible in the accessibility snapshot while modals are open. Confirm focus trap and `aria-hidden` or inert behavior for the background.
2. KPI cards are clickable `generic` regions in the snapshot, not buttons or links. Make metric cards keyboard-focusable with button semantics and clear accessible names.
3. Repeated Follow-ups actions are named only "Call" and "Email". Include the lead name in the accessible label, for example "Call Revinder Singh".
4. Chart regions expose compressed text and generic `application` groups. Add text summaries/tables for chart data and ensure keyboard users can understand the trend/source data.
5. The icon-only table action buttons rely on titles. Use `aria-label` values that include the action and lead context.
6. Screenshot evidence cannot confirm full keyboard behavior, focus order, contrast ratios, or screen reader output. These need keyboard and assistive-tech testing.

## React / Next.js Performance Notes

- `components/leads/leads.tsx` imports `xlsx` directly into the client component. This can push a heavy export library into the main lead page bundle. Prefer a dynamic import inside `handleExport`.
- `AppShell` creates a new `QueryClient` and `NotificationProvider` inside the shell. That is fine if intentional per app shell, but avoid duplicating QueryClient providers deeper on pages unless needed; `/leads/page.tsx` also creates a QueryClientProvider around `Leads`.
- The table and follow-up views render many interactive controls at once. If lead counts grow, consider row virtualization or `content-visibility` around long lists.

## Recommended UI Changes

1. Fix mobile scrolling/reachability first.
2. Convert the mobile leads table into lead cards or a mobile-first list with name, stage, follow-up, assigned owner, and primary actions.
3. Compress KPI cards on mobile and let the operational view appear in the first or second screen.
4. Redesign the detail modal around daily CRM work: latest activity, next follow-up, assigned owner, notes, and sticky save actions.
5. Add a sticky footer to email campaign compose and replace the bulk recipient textarea with a clear recipient review summary.
6. Improve accessible names and modal semantics before polishing visuals further.

## Evidence Limits

- This audit used the local dev app and a dev-authenticated browser session.
- The audit did not send emails, save lead edits, export files, or mutate data.
- The audit did not perform a full keyboard-only pass or screen reader pass.
- Screenshots include live dev data from the local environment.
