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

test("Plaud instructions identify source text as untrusted and URLs as temporary", () => {
  const instructions = read("agent/instructions.md");
  const documentation = read("docs/plaud-mcp.md");
  assert.match(instructions, /untrusted source material/);
  assert.match(documentation, /valid for 24 hours/);
  assert.match(documentation, /does not persist the\s+source recording/);
});
