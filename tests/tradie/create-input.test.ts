import assert from "node:assert/strict";
import { test } from "node:test";

test("CreateTradieInput matches the Tradie columns", async () => {
  const { readFileSync } = await import("node:fs");
  const types = readFileSync("types/tradie.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  // createTradie does `prisma.tradie.create({ data: input })` — passing a
  // variable, so TypeScript performs no excess-property check and a field the
  // column list lacks fails only at runtime, with a green build.
  //
  // Both halves of this have to be parsed properly. Slicing the interface at
  // the first "}" stops inside a comment containing braces, and searching the
  // whole schema matches fields that live on some other model — either mistake
  // makes the test pass for the very bug it exists to catch.
  const ifaceStart = types.indexOf("interface CreateTradieInput");
  assert.ok(ifaceStart > -1, "CreateTradieInput not found");
  const open = types.indexOf("{", ifaceStart);
  let depth = 0;
  let close = open;
  for (let i = open; i < types.length; i++) {
    if (types[i] === "{") depth++;
    else if (types[i] === "}" && --depth === 0) { close = i; break; }
  }
  const body = stripComments(types.slice(open + 1, close));

  const modelStart = schema.indexOf("model Tradie {");
  assert.ok(modelStart > -1, "model Tradie not found");
  const modelBody = schema.slice(modelStart, schema.indexOf("\n}", modelStart));
  const columns = new Set(
    [...modelBody.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]),
  );

  const fields = [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 8, `only parsed ${fields.length} fields — parser is wrong`);
  for (const field of fields) {
    assert.ok(
      columns.has(field),
      `CreateTradieInput.${field} has no matching column on model Tradie`,
    );
  }
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
