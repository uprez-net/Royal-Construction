import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { OutboxEventKind } from "@prisma/client";
import { test } from "vitest";

import { ROOT } from "./module-graph";

// `OutboxEventKind` is a schema change on purpose: the model comment says
// adding a kind means defining its payload, idempotency key and recovery
// behaviour before anything can enqueue it. That promise is only worth
// something if the enum cannot grow entries nothing produces — an unused kind
// reads as "this effect is durable" to the next person, and it is not.
//
// Phase 6 landed the enum with eight kinds and producers for three of them.
// This is the test that would have said so.

const SEARCH_ROOTS = ["lib", "app", "agent"];

function sourceFiles(dir: string): string[] {
  const absolute = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(relative(ROOT, full));
    }
    return entry.endsWith(".ts") || entry.endsWith(".tsx") ? [full] : [];
  });
}

const sources = SEARCH_ROOTS.flatMap((dir) => sourceFiles(dir)).filter(
  (file) => !file.includes(`${join("lib", "domain", "outbox.ts")}`),
);

const corpus = sources.map((file) => readFileSync(file, "utf8")).join("\n");

test("every declared outbox kind has a producer", () => {
  const unused = Object.values(OutboxEventKind).filter(
    (kind) => !corpus.includes(`OutboxEventKind.${kind}`),
  );
  assert.deepEqual(
    unused,
    [],
    "These OutboxEventKind values are declared in the schema but nothing enqueues them. Either wire the effect or drop the kind — a kind with no producer tells the next reader that effect is durable when it is not.",
  );
});

test("the outbox is reached through the guard, not by hand", () => {
  // enqueue/claim/complete/fail are the worker's vocabulary and the cron uses
  // them directly. What must not spread is ad-hoc `outboxEvent` writes that
  // skip the claim, because the claim is the only thing making two workers
  // safe.
  const offenders = sources.filter((file) => {
    const text = readFileSync(file, "utf8");
    if (!/\b(prisma|db|tx)\.outboxEvent\.(create|upsert|update)\b/.test(text)) {
      return false;
    }
    return !file.includes(join("lib", "domain"));
  });
  assert.deepEqual(
    offenders.map((file) => relative(ROOT, file)),
    [],
    "Write to OutboxEvent through lib/domain/outbox.ts so the claim and the status transitions stay in one place.",
  );
});
