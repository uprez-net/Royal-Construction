import assert from "node:assert/strict";
import { test } from "node:test";

import { satisfiesRole } from "../../lib/tools/authz";
import { getWebMcpToolDescriptors, toToolInputJsonSchema } from "../../lib/tools/json-schema";
import { TOOL_MANIFEST, findTool } from "../../lib/tools/manifest";

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
        assert.ok(
            typeof schema.properties === "object" || tool.name === "get_all_tradies",
            `${tool.name} converted without a properties map`,
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

test("destructive tools are admin-gated", () => {
    assert.equal(findTool("delete_lead")?.requiredRole, "ADMIN");
    assert.equal(findTool("update_variation_status")?.requiredRole, "ADMIN");
});

test("upload_file is not exposed to the browser", () => {
    // It takes the file as base64 in its arguments, which a browser agent has
    // no way to produce. pick_and_upload_file is the browser affordance.
    assert.equal(findTool("upload_file")?.surface, "server");
    assert.ok(
        !getWebMcpToolDescriptors().some((tool) => tool.name === "upload_file"),
        "upload_file leaked into the browser tool list",
    );
});

test("the browser descriptor list carries schemas and annotations", () => {
    const descriptors = getWebMcpToolDescriptors();
    assert.ok(descriptors.length > 0);
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
