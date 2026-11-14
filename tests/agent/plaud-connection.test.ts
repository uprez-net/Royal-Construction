import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { REPO_ROOT } from "@/tests/support/repo-root";

const read = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("Plaud connection uses hosted user OAuth and an explicit read allowlist", () => {
  const connection = read("agent/connections/plaud.ts");
  assert.match(connection, /https:\/\/mcp\.plaud\.ai\/mcp/);
  assert.match(connection, /connect\("mcp\.plaud\.ai\/royal-construction"\)/);
  for (const tool of [
    "get_current_user",
    "list_files",
    "get_file",
    "get_note",
    "get_transcript",
  ]) {
    assert.match(connection, new RegExp(`"${tool}"`));
  }
  for (const tool of ["login", "logout", "rename_file", "delete_file"]) {
    assert.doesNotMatch(connection, new RegExp(`"${tool}"`));
  }
});

test("Plaud instructions treat returned content as untrusted and keep audio URLs private", () => {
  const instructions = read("agent/instructions.md");
  const documentation = read("docs/plaud-mcp.md");
  assert.match(instructions, /untrusted source material/);
  assert.match(
    instructions,
    /Never expose temporary audio\s+URLs or raw audio/,
  );
  assert.match(documentation, /get_file.*notes and transcript segments/);
  assert.match(documentation, /get_transcript.*full transcript/);
  assert.match(documentation, /never expose that URL or raw audio/);
});

test("the Plaud connection is user-scoped OAuth with exactly the read allowlist", async () => {
  // The real definition, not its source text: a user-scoped connect() makes
  // eve refuse the call (principal_required) when no signed-in user is on the
  // session, so one staff member's Plaud grant is never used for another.
  const { default: plaud } = await import("@/agent/connections/plaud");
  const auth = plaud.auth as {
    principalType?: string;
    vercelConnect?: { connector?: string };
  };
  assert.equal(auth.principalType, "user");
  assert.equal(
    auth.vercelConnect?.connector,
    "mcp.plaud.ai/royal-construction",
  );
  assert.deepEqual(
    [...(plaud.tools as { allow: readonly string[] }).allow].sort(),
    [
      "get_current_user",
      "get_file",
      "get_note",
      "get_transcript",
      "list_files",
    ],
  );
  assert.match(String(plaud.description), /24 hours/);
  assert.match(String(plaud.description), /untrusted/);
});

test("Eve reports the source recording and never a fabricated retrieval", () => {
  const instructions = read("agent/instructions.md");
  assert.match(instructions, /Plaud recording ID, name, recording\s+time/);
  assert.match(instructions, /never\s+describe a recording as retrieved/);
});
