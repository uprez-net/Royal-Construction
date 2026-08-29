import assert from "node:assert/strict";
import { test } from "node:test";

import {
    GLOBAL_TOOLS,
    LEAD_DETAIL_TABS,
    LEAD_TAB_TOOLS,
    NAVIGABLE_PROJECT_TABS,
    PROJECT_TAB_TOOLS,
    VISIBLE_PROJECT_DETAIL_TABS,
    leadSurfaceTools,
    projectSurfaceTools,
} from "../../lib/tools/surfaces";
import { TOOL_NAMES } from "../../lib/tools/manifest";

/**
 * lib/tools/surfaces.ts is a promise: it tells an agent what navigating will
 * get it. A promise nothing checks is a promise that rots, and the failure is
 * silent — the agent is told a tool exists, does not find it, and concludes the
 * capability is missing.
 *
 * The real check is the Puppeteer suite, which compares these lists against
 * what a page actually registers. These tests cover the half that can be
 * checked without a browser: that the map agrees with the shared manifest, and
 * that every tab has an entry.
 */

/** The browser-only tools from components/webmcp/ui-tools.ts. */
const UI_TOOL_NAMES = [
    "get_current_view",
    "get_operating_guide",
    "navigate_to",
    "navigate_to_lead",
    "navigate_to_project",
];

test("every shared manifest tool is listed as globally available", () => {
    for (const name of TOOL_NAMES) {
        assert.ok(
            GLOBAL_TOOLS.includes(name as (typeof GLOBAL_TOOLS)[number]),
            `${name} is in the manifest but missing from GLOBAL_TOOLS`,
        );
    }
});

test("GLOBAL_TOOLS claims nothing that is not a manifest tool or a UI tool", () => {
    const known = new Set([...TOOL_NAMES, ...UI_TOOL_NAMES]);
    for (const name of GLOBAL_TOOLS) {
        assert.ok(known.has(name), `GLOBAL_TOOLS names ${name}, which nothing registers globally`);
    }
});

test("every tab has an entry, so a lookup can never miss silently", () => {
    for (const tab of LEAD_DETAIL_TABS) {
        assert.ok(tab in LEAD_TAB_TOOLS, `lead tab ${tab} has no entry in LEAD_TAB_TOOLS`);
    }
    for (const tab of VISIBLE_PROJECT_DETAIL_TABS) {
        assert.ok(tab in PROJECT_TAB_TOOLS, `project tab ${tab} has no entry in PROJECT_TAB_TOOLS`);
    }
});

test("payments is not offered for navigation", () => {
    // Its panel renders for an admin but its trigger is commented out in
    // project-tab-navigation.tsx, so an agent sent there has no way back.
    assert.ok(VISIBLE_PROJECT_DETAIL_TABS.includes("payments"));
    assert.ok(!NAVIGABLE_PROJECT_TABS.includes("payments" as never));
});

test("a surface list always includes the tools that survive a tab change", () => {
    // The screen-level tools belong to the record, not the tab, so every tab
    // must report them — otherwise switching tabs would read as losing them.
    for (const tab of NAVIGABLE_PROJECT_TABS) {
        assert.ok(projectSurfaceTools(tab).includes("navigate_to_project_tab"));
    }
    for (const tab of LEAD_DETAIL_TABS) {
        assert.ok(leadSurfaceTools(tab).includes("navigate_to_lead_tab"));
    }
});

test("an unknown tab degrades to the screen-level tools", () => {
    // Not an error path: the caller has already validated the tab. This only
    // guarantees the lookup cannot throw on a stale value and take a
    // navigation result down with it.
    assert.deepEqual(projectSurfaceTools("nonsense"), projectSurfaceTools(undefined));
    assert.deepEqual(leadSurfaceTools("nonsense"), leadSurfaceTools(undefined));
});
