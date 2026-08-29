import assert from "node:assert/strict";
import { test } from "node:test";

import { OPERATING_GUIDE } from "../../lib/tools/operating-guide";
import {
    GLOBAL_TOOLS,
    LEADS_LIST_TOOLS,
    LEAD_DETAIL_TOOLS,
    LEAD_TAB_TOOLS,
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
]);

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

test("the guide names no tool that nothing registers", () => {
    for (const name of toolNamesIn(OPERATING_GUIDE)) {
        if (NAMED_AS_RETIRED.has(name)) continue;
        assert.ok(
            REGISTERED.has(name),
            `the guide tells the agent about ${name}, which no surface registers`,
        );
    }
});

test("every registered tool appears in the guide", () => {
    const named = new Set(toolNamesIn(OPERATING_GUIDE));
    for (const name of REGISTERED) {
        assert.ok(named.has(name), `${name} is registered but the guide never mentions it`);
    }
});

test("the retirement table is complete", () => {
    // A stale tool list is the agent's problem to recover from, and it can only
    // do that if the guide says what replaced each name.
    const named = new Set(toolNamesIn(OPERATING_GUIDE));
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
