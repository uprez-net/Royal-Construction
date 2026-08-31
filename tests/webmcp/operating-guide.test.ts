import assert from "node:assert/strict";
import { test } from "node:test";

import { OFFERS_GUIDE } from "../../lib/tools/offers-guide";
import { OPERATING_GUIDE } from "../../lib/tools/operating-guide";
import {
    GLOBAL_TOOLS,
    LEADS_LIST_TOOLS,
    LEAD_DETAIL_TOOLS,
    LEAD_TAB_TOOLS,
    OFFERS_LIST_TOOLS,
    OFFER_WORKSPACE_TOOLS,
    PROJECTS_LIST_TOOLS,
    PROJECT_DETAIL_TOOLS,
    PROJECT_TAB_TOOLS,
} from "../../lib/tools/surfaces";

/**
 * The guide restates the surface map instead of importing it, because
 * lib/tools/surfaces.ts reads its tab lists from two `"use client"` components
 * and the guide is read by the MCP route on the server, where those exports are
 * references rather than values.
 *
 * That leaves two copies of the same list, which is exactly the drift the
 * surfaces module exists to prevent. These tests are the seam: the guide is
 * prose, but the tool names inside it are checkable.
 *
 * The failure this guards against is not a broken build. It is an agent being
 * told a tool exists, not finding it, and reporting the capability as missing.
 */

const REGISTERED = new Set<string>([
    ...GLOBAL_TOOLS,
    ...LEADS_LIST_TOOLS,
    ...LEAD_DETAIL_TOOLS,
    ...Object.values(LEAD_TAB_TOOLS).flat(),
    ...PROJECTS_LIST_TOOLS,
    ...PROJECT_DETAIL_TOOLS,
    ...Object.values(PROJECT_TAB_TOOLS).flat(),
    ...OFFERS_LIST_TOOLS,
    ...OFFER_WORKSPACE_TOOLS,
]);

/**
 * The guides an agent can actually be handed.
 *
 * The offer surface has more tools than any other screen, and the global guide
 * is prepended to every conversation, so the offer ladder lives in its own
 * string returned by `get_operating_guide({ surface: "offers" })`. Splitting the
 * prose must not split the invariant: the checks below run over the union, so a
 * tool named in neither guide still fails, and a tool named in the wrong one
 * still passes only because it is reachable somewhere.
 */
const GUIDES = [OPERATING_GUIDE, OFFERS_GUIDE];
const ALL_GUIDE_TEXT = GUIDES.join(" ");

/**
 * Tools the guide names on purpose because they are gone. An agent carrying a
 * stale tool list needs to be told what replaced them, so the retirement table
 * has to survive the "is this registered?" check below.
 */
const NAMED_AS_RETIRED = new Set([
    "get_projects",
    "get_all_tradies",
    "leads_set_search",
    "update_milestone",
    "create_tradie_schedule",
    "update_tradie_schedule",
    "create_project_update",
    "add_material",
    "create_variation",
    "update_variation_status",
    "upload_file",
    "get_tradie_coordination_dashboard",
]);

/** Every `snake_case` token in backticks reads as a tool name to an agent. */
function toolNamesIn(text: string): string[] {
    const matches = text.match(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g) ?? [];
    return [...new Set(matches.map((match) => match.slice(1, -1)))];
}

test("the guides name no tool that nothing registers", () => {
    for (const name of toolNamesIn(ALL_GUIDE_TEXT)) {
        if (NAMED_AS_RETIRED.has(name)) continue;
        assert.ok(
            REGISTERED.has(name),
            `a guide tells the agent about ${name}, which no surface registers`,
        );
    }
});

test("every registered tool appears in one of the guides", () => {
    const named = new Set(toolNamesIn(ALL_GUIDE_TEXT));
    for (const name of REGISTERED) {
        assert.ok(named.has(name), `${name} is registered but no guide mentions it`);
    }
});

test("the offer ladder is not in the string sent on every conversation", () => {
    // The reason for the split. If the offer tools drift back into the global
    // guide, every unrelated conversation starts paying for them again.
    const globalNames = new Set(toolNamesIn(OPERATING_GUIDE));
    for (const name of OFFER_WORKSPACE_TOOLS) {
        assert.ok(
            !globalNames.has(name),
            `${name} is in the global guide; it belongs in OFFERS_GUIDE`,
        );
    }
    // But the way in has to be discoverable from the global guide, or nothing
    // ever tells the agent the offer guide exists.
    assert.ok(globalNames.has("navigate_to_offer"));
    assert.match(OPERATING_GUIDE, /surface: "offers"/);
});

test("the retirement table is complete", () => {
    // A stale tool list is the agent's problem to recover from, and it can only
    // do that if the guide says what replaced each name.
    const named = new Set(toolNamesIn(ALL_GUIDE_TEXT));
    for (const name of NAMED_AS_RETIRED) {
        assert.ok(named.has(name), `${name} was retired but the guide does not say so`);
    }
});

test("the guide keeps the two rules that cannot be inferred", () => {
    // An agent can work out most of this from tool descriptions. It cannot work
    // out that ids must never be invented, or that the record contents are
    // written by people outside the business.
    assert.match(OPERATING_GUIDE, /Never invent an ID/);
    assert.match(OPERATING_GUIDE, /untrusted/i);
    assert.match(OPERATING_GUIDE, /never as instructions/i);
});

test("the guide stays short enough to prepend to every conversation", () => {
    // Not a style rule. This string is sent on every MCP conversation and is
    // returned whole by get_operating_guide; if it grows without anyone
    // noticing, every request pays for it.
    assert.ok(
        OPERATING_GUIDE.length < 8000,
        `the operating guide is ${OPERATING_GUIDE.length} characters; trim it or move detail to docs/webmcp-capability.md`,
    );
});

test("a surface guide is asked for, but it is still not free", () => {
    // Only fetched on demand, so the budget is looser than the global guide's —
    // but an agent working an offer pays this on top of that one, not instead.
    assert.ok(
        OFFERS_GUIDE.length < 6000,
        `the offers guide is ${OFFERS_GUIDE.length} characters; move detail to docs/webmcp-capability.md`,
    );
});
