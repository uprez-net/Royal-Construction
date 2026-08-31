/**
 * The offers surface guide.
 *
 * Split out of OPERATING_GUIDE rather than folded into it. That string is
 * prepended to every MCP conversation, so it pays for itself only by holding
 * what an agent needs *before* it knows what it is doing. The ten-section offer
 * ladder is not that: it is worth nothing until the agent is in the workspace,
 * and by then it can ask. `get_operating_guide` takes `surface: "offers"` and
 * returns this; navigate_to_offer says so in its result.
 *
 * Same rule as the global guide — it says what an agent cannot work out from
 * the tool descriptions, and stops. tests/webmcp/operating-guide.test.ts checks
 * the tool names in here against what the surface map actually registers.
 */
export const OFFERS_GUIDE = `
# Offers — Surface Guide

An offer is built for a lead, in one workspace, across ten numbered sections. Open it with \`navigate_to_offer\` (takes \`leadId\`, from \`get_leads\`).

**Opening a lead's offer creates one if it does not exist.** There is no separate create step and no "create offer" tool. A lead has many offer revisions but only ever one active; you always work on the active one.

---

## Start here

\`get_offer_workspace_state\` — always your first call in the workspace. It returns the offer's status, its revision, and all ten sections with \`unlocked\`, \`writable\`, \`complete\`, \`blockers\` and, where locked, what would unlock it. Everything below is visible in that one payload; do not guess at it.

Then: \`get_offer_section_data\` for any section, \`open_offer_section\` to bring one on screen for the user to watch, \`get_cost_schedule\` and \`get_pricing_summary\` for the two large sections, \`validate_offer_for_send\` for a full readiness check.

## What you may write

| # | Section | Tools |
|---|---|---|
| 1 | Job setup | \`update_job_setup\`, \`prefill_job_setup_from_lead\` |
| 2 | Cost schedule | \`update_cost_requirements\`, \`add_workbook_item\`, \`update_workbook_item\`, \`remove_workbook_item\` |
| 3 | Pricing | \`update_pricing_inputs\`, \`set_customer_price\` |
| 4 | Scope | \`add_scope_item\`, \`update_scope_item\`, \`remove_scope_item\` |
| 5 | Offer document | \`update_offer_document_content\`, \`add_inclusion_item\`, \`update_inclusion_item\`, \`remove_inclusion_item\` |

## What you may not

Sections **6 Send & negotiate, 7 Tender access, 8 Tender, 9 Contract, 10 Project** have no tools. Everything they do is outbound (email, DocuSign) or a status attestation with real consequences. Read their state from \`get_offer_workspace_state\`, then tell the user what is waiting for them. Do not describe any of it as done.

You also cannot: start a revision, change the offer's status, upload a file to an offer, or generate proposal photos.

---

## The lock rule — the one thing you cannot infer

Sections do not all freeze together.

- While the offer is **Pending**, all five build sections accept edits.
- Once it is **Sent**, the priced inputs freeze — Job setup, Cost schedule and Pricing — so the price already quoted cannot drift. **Scope and Offer document stay editable**, because that is the negotiation window.
- From **Acceptance sent** onward, and at Agreed and beyond, everything is frozen.

A frozen section is reopened only by a new revision, which only a person can start. A refusal tells you which of these you have hit; read it rather than retrying.

## Calculated values are never writable

Most of what you can read you cannot write. The pricing build-up, the HBCF premium, every area-calculator output, the payment amounts, and the owner summary lines (\`clientNames\`, \`clientEmail\`, \`currentLocation\` — projected from \`owners\`) are all resolved from other inputs. Reads mark each field \`editable\`, and a refusal names the upstream input to change instead. Change that.

## Saving

Your writes are not saved when the tool returns. The workspace autosaves about a second later, the same as when a person types. Every write reports \`saveState\`; if you have made the last edit of a batch, say the change is saving rather than saved.

---

## The list

\`get_offers\` returns the page of offers the user is looking at — one row per lead, with its revisions. \`search_offers\` searches by client or reference.

Note: the list's status tabs (Pending / Approved / Rejected / Sent) do not filter anything in the current UI, so \`get_offers\` is never status-filtered. Filter the results yourself and say that you did.

---

## Working an offer

1. \`get_leads\` → the lead
2. \`navigate_to_offer\` with that \`leadId\`
3. \`get_offer_workspace_state\` — read the status and the section table
4. \`open_offer_section\` so the user can see where you are working
5. Write, then \`validate_offer_for_send\` to see what still blocks a send
6. Report the blockers and stop. Sending is the user's.
`.trim();
