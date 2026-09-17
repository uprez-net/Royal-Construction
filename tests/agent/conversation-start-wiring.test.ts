import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Eve channel requests bypass Clerk page protection", () => {
  const proxy = readFileSync("proxy.ts", "utf8");

  assert.match(proxy, /"\/eve\/v1\(\.\*\)"/);
});

test("the first session URL update does not race the registry write", () => {
  const workspace = readFileSync(
    "components/agent/agent-workspace.tsx",
    "utf8",
  );
  const callback = workspace.slice(
    workspace.indexOf("const onSessionChange"),
    workspace.indexOf("const agent = useEveAgent"),
  );

  assert.match(callback, /window\.history\.replaceState\(/);
  assert.doesNotMatch(callback, /router\.replace\(/);
});
