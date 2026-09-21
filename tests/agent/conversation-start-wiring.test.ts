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
  const message = readFileSync("components/agent/agent-message.tsx", "utf8");
  const callback = workspace.slice(
    workspace.indexOf("const onSessionChange"),
    workspace.indexOf("const agent = useEveAgent"),
  );

  assert.match(callback, /window\.history\.replaceState\(/);
  assert.doesNotMatch(callback, /router\.replace\(/);

  const agentOptions = workspace.slice(
    workspace.indexOf("const agent = useEveAgent"),
    workspace.indexOf("const busy"),
  );
  assert.doesNotMatch(agentOptions, /router\.refresh\(/);
  assert.match(agentOptions, /payload\.clientContext/);
  assert.match(agentOptions, /route: window\.location\.pathname/);
  assert.match(agentOptions, /typeof payload\.clientContext/);
  assert.match(workspace, /pendingMessageAnnotationsRef/);
  assert.match(message, /aria-label="Message annotations"/);
});
