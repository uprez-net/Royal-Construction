import assert from "node:assert/strict";
import { test } from "node:test";

import { TOOL_MANIFEST } from "../../lib/tools/manifest";

/**
 * Manifest/handler parity — the invariant the whole shared-registry design
 * rests on. If a tool is declared but unimplemented (or the reverse), the MCP
 * server and the WebMCP bridge start disagreeing about what exists.
 *
 * lib/tools/registry.server.ts throws at import time when they diverge, so this
 * test simply imports it and then checks the joined list. That import pulls in
 * Prisma and the whole data layer, which is why this is slow and lives in its
 * own file rather than alongside the fast manifest checks.
 */
test("every manifest entry has a handler, and every handler a manifest entry", async () => {
    const { TOOL_REGISTRY, getRegisteredTool } = await import("../../lib/tools/registry.server");

    assert.equal(
        TOOL_REGISTRY.length,
        TOOL_MANIFEST.length,
        "registry and manifest are different sizes",
    );

    for (const tool of TOOL_MANIFEST) {
        const registered = getRegisteredTool(tool.name);
        assert.ok(registered, `${tool.name} is in the manifest but not in the registry`);
        assert.equal(typeof registered.invoke, "function", `${tool.name} has no invocable handler`);
    }
});
