import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// These modules opened with "use server", which makes every export a Server
// Action: an endpoint that becomes callable over the network the moment any
// client module imports it. None of them authorizes its caller — saveFile
// writes a File row for whatever userId it is handed, generatePDF runs headless
// Chromium on arbitrary HTML, handleProjectSpecsGeneration spends model tokens,
// createProjectWithLead converts whatever lead id it is handed. Every real
// caller is server-side (route handlers, workflow steps and other action
// modules), so they are plain server modules guarded by "server-only" instead.
// That closes only the direct endpoints: an action that calls one of them must
// still authorize its own caller, as lib/actions/projects.ts does.

const ROOT = join(__dirname, "..", "..");

const SERVER_HELPERS = [
  "lib/agent/projectCreationAgent.ts",
  "lib/data/file.ts",
  "lib/data/projectsWrite.ts",
  "lib/utils/generatePDF.ts",
];

/** The directive prologue: string-literal statements before any code. */
function directives(source: string): string[] {
  const found: string[] = [];
  let rest = source.replace(/^﻿/, "");
  for (;;) {
    rest = rest.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/, "");
    const match = /^(["'])([^"'\n]*)\1\s*;?/.exec(rest);
    if (!match) return found;
    found.push(match[2]);
    rest = rest.slice(match[0].length);
  }
}

test("the directive reader sees a use-server prologue, even after comments", () => {
  assert.deepEqual(directives(`"use server";\nimport x from "y";`), ["use server"]);
  assert.deepEqual(directives(`// why\n/* more */\n'use server'\n`), ["use server"]);
  assert.deepEqual(directives(`import "server-only";\n"use server";`), []);
});

for (const file of SERVER_HELPERS) {
  const source = readFileSync(join(ROOT, file), "utf8");

  test(`${file} is not a Server Action module`, () => {
    assert.ok(
      !directives(source).includes("use server"),
      `${file} declares "use server", so each export is a public endpoint`,
    );
  });

  test(`${file} refuses to load in a client bundle`, () => {
    assert.match(source, /^import ["']server-only["'];?$/m);
  });
}
