# WebMCP — The Offers Surface

Twenty-four tools covering the offers list and the first five sections of the
offer workspace. Read this alongside [webmcp-capability.md](./webmcp-capability.md),
which is authoritative for the runtime itself; this document covers only what is
particular to offers.

The short version: an agent can now find an offer, read every part of it, and do
the data-entry work — job setup, the cost workbook, pricing, scope, the offer
document. It cannot send anything, change a status, generate a tender, or create
a project. Those are sections 6–10 and they have no tools.

---

## The tools

### Offers list — `components/offers/offer-table.tsx`

| Tool | Notes |
| --- | --- |
| `get_offers` | The page of offer groups the user is looking at, read out of `state.offers` rather than refetched. One row per lead, with its revision count and latest amounts. |
| `search_offers` | Wraps the existing `fetchOffers({ q })` thunk. Always lands on page 1 — a search that kept the old page number would land on an empty page whenever the result set shrank. |

`get_offers` reports `statusFilter: null` and says in the payload that the
list's status tabs do not filter anything. That is not a hedge, it is the truth:
`tabId` in `offer-filter.tsx` is local state nothing reads. An agent that
assumed the tabs worked would under-report, so the tool says so and tells it to
filter the rows itself.

### Global — `components/webmcp/ui-tools.ts`

`navigate_to_offer` takes a `leadId` and opens `/offers/<leadId>`.

**It is the one global tool that is not read-only.** Opening a lead's offer
workspace *provisions* the `Offer` row if the lead has none — that is ADR 0002,
and it is why there is no `create_offer` tool. `create-offer-modal.tsx`, despite
its name, is a lead picker that calls `router.push` and nothing else. Navigation
is creation.

So the tool declares `readOnlyHint: false`, and
`e2e/webmcp/surface-scoping.test.ts` carves it out of the "the dashboard is
read-only" sweep by name, with the reason. Labelling it read-only to keep that
loop tidy would have been exactly the mislabelling the annotation exists to catch.

### Offer workspace — `components/offers/new-workflow/new-offer-workspace.tsx`

Orientation and reads:

| Tool | Notes |
| --- | --- |
| `get_offer_workspace_state` | The entry point. Status, revision, `stateVersion`, `saveState`, and all ten sections with `unlocked` / `writable` / `complete` / `blockers` / `unlockCondition`. |
| `get_offer_section_data` | One section's values, with `editable` flags and the upstream input named for anything calculated. |
| `open_offer_section` | Expands and scrolls, so the user can watch. |
| `get_cost_schedule` | Dedicated: the workbook is too large for the parameterised read, and the manual/formula distinction is the whole point. |
| `get_pricing_summary` | Dedicated: four inputs against nine calculated rows. |
| `validate_offer_for_send` | Preflight. Blockers and warnings, separated. |

Writes, by section: `update_job_setup`, `prefill_job_setup_from_lead` ·
`update_cost_requirements`, `add_workbook_item`, `update_workbook_item`,
`remove_workbook_item` · `update_pricing_inputs`, `set_customer_price` ·
`add_scope_item`, `update_scope_item`, `remove_scope_item` ·
`update_offer_document_content`, `add_inclusion_item`, `update_inclusion_item`,
`remove_inclusion_item`.

---

## Why everything registers from one component

Every other detail screen keys its tools by tab — `lead-overview-tab.tsx`,
`project-milestones-tab.tsx` — because only the open tab's panel is mounted, so
a tab's tools genuinely appear and disappear as the user moves.

The offer workspace is the opposite shape. Its ten sections are JSX inside
`offer-workspace-screen.tsx` with no per-section state owners: all thirty-nine
`useState`s live in the container. There is nowhere else for a tool to close
over the state it needs.

So `OFFER_WORKSPACE_TOOLS` is a flat list rather than a map, the registry is
stable for as long as the workspace is open, and gating happens at call time
instead of at registration time. Definitions live in
`components/offers/new-workflow/webmcp/` as factories the container composes, so
that file does not grow another six hundred lines.

---

## The lock model

This is the one thing an agent cannot work out for itself, and the reason
`lib/offer/webmcp-gating.ts` exists.

Sections do not all freeze together:

- **Pending** — all five build sections accept edits.
- **Sent** — the priced inputs freeze (Job setup, Cost schedule, Pricing) so the
  quoted price cannot drift in place. **Scope and Offer document stay editable**;
  that is the negotiation window.
- **Acceptance sent onward** — everything is frozen.

The gate invents none of this. `assertSectionWritable` defers entirely to
`isOfferBuildStepEditable` in `lib/offer/offer-editability.ts` — the same
predicate that decides whether `OfferStepSection` renders a disabled
`<fieldset>`. A tool and a form cannot disagree about the same offer, and
`tests/offer/webmcp-gating.test.ts` asserts that agreement over all seventeen
statuses × five steps.

What the module adds is wording. A refusal has to name a way forward, and the
way forward differs:

| At | The refusal says |
| --- | --- |
| `superseded` | Open the lead's active revision and work there. |
| `rejected` | A person has to move it back to Pending first. |
| `sent` (priced inputs) | Frozen so the price cannot drift — Scope and the Offer document are still editable. |
| anything later | Needs a new revision, which only a person can start. |

A test asserts those four stay four, because collapsing any two would send the
agent the wrong way.

`open_offer_section` is deliberately *not* gated the same way. A frozen section
is still worth showing — the user may want to read it — so it opens and reports
`readOnly: true` rather than refusing. Only the phase gates (7–10) refuse
outright, and they return the same `unlockCondition` string the locked panel
shows the user, shared from `OFFER_PHASE_UNLOCK_HINT`.

---

## Calculated values are never writable

Most of what an offer shows is resolved from something else: the whole pricing
build-up, the HBCF premium, every area-calculator output, payment amounts, the
contract-particular defaults, and the owner summary fields (`clientNames`,
`clientEmail`, `currentLocation`) projected from `owners[]`.

Reads mark fields `editable` and carry a `derivedFrom` map. Writes refuse, and
the refusal names the input to change instead:

```
homeWarrantyHbcfFixed is calculated, not stored — writing to it would be
discarded on the next recompute. It is resolved from hbcfTotalContractValue,
the HBCF rate and the admin loading charge — set hbcfTotalContractValue instead.
```

Naming the upstream is the point. A bare "not editable" leaves the agent
guessing, and guessing here means it edits the wrong field or reports the
capability as missing.

The owner-projected fields are the sharpest case: writing `clientNames`
directly would stick until the next owner edit and then silently revert, and in
between the offer would print a name nobody entered.

---

## Writes are not saved when the tool returns

A write tool calls the same mutator a keystroke calls — `updateJob`,
`updateLine`, `updateDraft` — and then returns. It does **not** save.

The workspace's existing 800 ms debounced autosave persists it through
`saveOfferWorkspace` with `expectedStateVersion`, exactly as a human edit is
persisted. That is deliberate and it is the most important constraint in the
design: a tool that saved directly would bypass the optimistic-concurrency
reconciliation the autosave already does (`stale` / `superseded` → reload and
rehydrate, per ADR 0002).

So every write returns `saved` and `saveState`, and says so:

> The workspace autosaves a moment after a change. Say the edit is saving, not
> saved, unless saveState is already "saved".

There is no `expectedRevision` parameter. Concurrency was already solved; adding
a second mechanism beside `stateVersion` would only give the two a chance to
disagree.

### Other consequences worth knowing

- **Partial patches report per-field errors.** An agent that sent five fields
  and one bad number is told which one, rather than having the other four
  silently dropped. Nothing partially applies — the patch is rejected whole.
- **A newly added row's id is not knowable on the same call.** `addLine` and
  `addAllowance` are `setState`s, so `add_workbook_item` and `add_scope_item`
  return `pending: true` and point at the read tool when React has not
  re-rendered yet.
- **`offerTenderLineItem` and `notesOrSpec` are written together**, because the
  grid writes both from one textarea. Letting a tool diverge them would create a
  state no click can produce or repair.
- **Pricing a cost row includes it in the contract**, mirroring the grid.

---

## The operating guide split

`OPERATING_GUIDE` is prepended to every MCP conversation, and
`tests/webmcp/operating-guide.test.ts` also requires every registered tool to be
named in a guide. Twenty-four more tools did not fit — the string was at 6,790
characters against an 8,000 cap.

So the guide split:

- `lib/tools/operating-guide.ts` keeps the global rules, the loop, and the leads
  and projects tables. Offers get two lines pointing elsewhere.
- `lib/tools/offers-guide.ts` holds `OFFERS_GUIDE` — the section ladder, the lock
  rule, the calculated-values rule, and what sections 6–10 are for.
- `get_operating_guide` takes an optional `surface: "offers"`. An unknown surface
  is refused rather than silently defaulted to the platform guide.
- `navigate_to_offer` names the follow-up call in its `nextActions`, so the way
  in travels with the navigation.

The test now runs its two invariants over the **union** of both guides, plus a
new one asserting the offer tools are *not* in the global string — otherwise the
split would quietly undo itself the first time someone documented a tool in the
convenient place. Each guide keeps its own cap: global under 8,000, offers under
6,000.

---

## What is deliberately absent

No tool sends an offer, marks it sent or agreed, starts a revision, generates or
sends a tender, sends a contract, creates a project, records the architectural
plan fee, uploads a file, or generates a proposal photo.

Everything in sections 6–10 is either outbound or a status attestation with real
consequences, and several are irreversible. They appear in
`get_offer_workspace_state` so the agent can see the whole ladder and report
where the offer is, each marked:

> This section has no tools. Everything it does is outbound or a status change,
> so a person performs it.

When they are built, the pattern is already settled by `send_lead_message`: set
draft state, open the real dialog, return `webMcpText("…nothing has gone out")`.
There is no confirmation-token primitive in the runtime and none is needed.

---

## Testing

**Unit — `pnpm test`.** 672 tests, up from 624.

- `tests/offer/webmcp-gating.test.ts` — the gate over all seventeen statuses ×
  five steps. The highest-value test here: a pure function over a small matrix,
  and the thing that stops a write landing on a frozen offer.
- `tests/offer/webmcp-tools.test.ts` — the six factories called with fake
  mutators. **This is where successful writes are covered**, and where the
  registered tool list is asserted against `OFFER_WORKSPACE_TOOLS`.

**Browser — `pnpm test:webmcp`.** 52 tests, up from 25.

- `offers-list.test.ts`, `offer-workspace.test.ts` — registration and reads.
- `offer-workspace-gating.test.ts` — refusals, each one also asserting
  `stateVersion` did not move.

The split between the two is not arbitrary. The smoke suite performs no
destructive writes, and that matters more on offers than anywhere else in it: a
workspace write is picked up by the autosave and persisted against a real offer
within a second, so a test that "just changes a headline" changes a real
headline. Successful writes therefore live in the unit suite, against fakes,
where they are also faster and deterministic.

One browser assertion is worth calling out: `open_offer_section` checks the
panel actually expanded in the DOM, not just that the tool returned
`opened: true`. The open state had to be lifted out of `OfferStepSection` for
that to be possible, and a tool reporting success while the user stares at a
collapsed header is precisely the failure worth catching.

---

## Found, not fixed

Recorded here rather than repaired, because each changes behaviour the UI owns:

- **The offers list status tabs filter nothing.** `tabId` (`offer-filter.tsx:25`)
  is local state nothing reads. Search also fires a server round-trip per
  keystroke with no debounce, and clearing the box never resets the list.
- **`inclusionFindingCount` is never passed** to `collectOfferSendBlockers`
  (`offer-workspace-send-negotiate.tsx`), so the inclusion-consistency warning
  can never fire. `validate_offer_for_send` has the findings in hand and could
  pass it — one argument — but it would change what the UI shows.
- `SequenceMappingPanel` and `StageSubtotalStrip` are unreferenced dead
  components.
- Screen tools still run with the full ambient session; see the same gap in
  [webmcp-phase-two-plan.md](./webmcp-phase-two-plan.md).
