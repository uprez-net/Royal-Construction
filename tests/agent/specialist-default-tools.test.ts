import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { disableTool } from "eve/tools";

import { REPO_ROOT } from "../support/repo-root";
import { DISABLED_DEFAULT_TOOLS } from "../support/eve-default-tools";

const SUBAGENTS_DIR = path.join(REPO_ROOT, "agent", "subagents");

function declaredSpecialists(): string[] {
  return readdirSync(SUBAGENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test("no declared specialist keeps an eve default tool it has disabled", async () => {
  for (const name of declaredSpecialists()) {
    for (const tool of DISABLED_DEFAULT_TOOLS) {
      const relative = `agent/subagents/${name}/tools/${tool}.ts`;
      assert.ok(
        existsSync(path.join(REPO_ROOT, relative)),
        `${relative} is missing: eve would give ${name} its default ${tool} tool`,
      );
      const mod = (await import(`@/agent/subagents/${name}/tools/${tool}`)) as {
        default: unknown;
      };
      assert.deepEqual(
        mod.default,
        disableTool(),
        `${relative} must default-export disableTool()`,
      );
    }
  }
});
