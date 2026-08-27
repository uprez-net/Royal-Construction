import assert from "node:assert/strict";
import { test } from "node:test";

import { satisfiesRole } from "../../lib/tools/authz";
import { getWebMcpToolDescriptors } from "../../lib/tools/json-schema";
import { TOOL_MANIFEST, TOOL_NAMES, findTool } from "../../lib/tools/manifest";
import { toToolInputJsonSchema } from "../../lib/tools/zod-to-json-schema";

/**
 * The manifest is the single source of truth for both transports, so the things
 * that would rot silently are asserted here: schema conversion, the annotations
 * an agent reads to decide how careful to be, and the role gate.
 *
 * Handler parity lives in registry-parity.test.ts, which has to boot the server
 * dependency graph and is correspondingly slow.
 */

test("every tool has a usable name and description", () => {
    for (const tool of TOOL_MANIFEST) {
        assert.ok(tool.name.length > 0, "a tool has an empty name");
        assert.ok(
            /^[a-z][a-z0-9_]*$/.test(tool.name),
            `${tool.name} is not snake_case; agents match on these names`,
        );
        assert.ok(
            tool.description.trim().length > 0,
            `${tool.name} has no description — the agent has nothing to select on`,
        );
    }
});

test("tool names are unique", () => {
    const seen = new Set<string>();
    for (const tool of TOOL_MANIFEST) {
        assert.ok(!seen.has(tool.name), `duplicate tool name: ${tool.name}`);
        seen.add(tool.name);
    }
});

test("every input schema converts to a JSON Schema object", () => {
    // WebMCP takes JSON Schema, not Zod. A schema that throws here would drop
    // its tool from the browser's list at registration time, silently.
    for (const tool of TOOL_MANIFEST) {
        const schema = toToolInputJsonSchema(tool.inputSchema);
        assert.equal(
            schema.type,
            "object",
            `${tool.name} did not convert to an object schema (got ${String(schema.type)})`,
        );
    }
});

test("readOnlyHint follows the verb", () => {
    // An agent uses readOnlyHint to decide whether a call needs confirming.
    // A write mislabelled as read-only is the failure that actually costs data.
    for (const tool of TOOL_MANIFEST) {
        const looksReadOnly = tool.name.startsWith("get_") || tool.name.endsWith("_lookup");
        assert.equal(
            tool.annotations.readOnlyHint,
            looksReadOnly,
            `${tool.name}: readOnlyHint is ${tool.annotations.readOnlyHint} but the name says otherwise`,
        );
    }
});

test("approving a variation stays admin-gated", () => {
    assert.equal(findTool("update_variation_status")?.requiredRole, "ADMIN");
});

/**
 * These tools were retired from the shared manifest because their browser flow
 * no longer matches the server action the handler wrapped. They now live with
 * the screens that own them — components/leads/leads.tsx,
 * components/leads/detail/lead-detail-screen.tsx,
 * components/projects/projects-client.tsx,
 * components/projects/project-detail-screen.tsx and
 * components/tradies/tradies-client.tsx.
 *
 * Re-adding one here would put a second, diverging implementation back on the
 * MCP surface, which is the exact problem the move solved.
 */
const RETIRED_FROM_MANIFEST = [
    "create_project",
    "create_project_update",
    "create_milestone",
    "add_milestone_photos",
    "update_milestone",
    "create_lead",
    "update_lead",
    "delete_lead",
    "create_tradie_schedule",
    "update_tradie_schedule",
    "upload_file",
    // Removed outright: the coordination dashboard is a screen aggregate, not
    // a tool an agent can act on.
    "get_tradie_coordination_dashboard",
];

test("retired tools have not crept back into the manifest", () => {
    for (const name of RETIRED_FROM_MANIFEST) {
        assert.ok(
            !TOOL_NAMES.includes(name),
            `${name} is back in the manifest; it belongs to a screen now`,
        );
    }
});

test("the manifest is reads plus the two writes that still match the server", () => {
    // A guard on scope, not a snapshot: every write left here must be one whose
    // browser path and server path are still the same operation.
    const writes = TOOL_MANIFEST
        .filter((tool) => !tool.annotations.readOnlyHint)
        .map((tool) => tool.name)
        .sort();

    assert.deepEqual(writes, ["add_material", "create_variation", "update_variation_status"]);
});

test("the browser descriptor list carries schemas and annotations", () => {
    const descriptors = getWebMcpToolDescriptors();
    assert.equal(descriptors.length, TOOL_MANIFEST.length);
    for (const descriptor of descriptors) {
        assert.equal(typeof descriptor.inputSchema, "object");
        assert.equal(typeof descriptor.annotations.readOnlyHint, "boolean");
    }
});

test("role gate: a non-admin cannot reach an admin tool", () => {
    assert.equal(satisfiesRole("ADMIN", "SITE_MANAGER"), false);
    assert.equal(satisfiesRole("ADMIN", "CUSTOMER"), false);
    assert.equal(satisfiesRole("ADMIN", "GUEST"), false);
    assert.equal(satisfiesRole("ADMIN", undefined), false);
    assert.equal(satisfiesRole("ADMIN", "ADMIN"), true);
    // No requirement means anyone signed in may call it.
    assert.equal(satisfiesRole(undefined, "GUEST"), true);
    // ADMIN satisfies any other requirement.
    assert.equal(satisfiesRole("SITE_MANAGER", "ADMIN"), true);
});
