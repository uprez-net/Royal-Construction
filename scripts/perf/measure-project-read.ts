// Measures the project detail read: SQL statements, time and payload size.
//
// Run: pnpm tsx scripts/perf/measure-project-read.ts <projectId> [runs]
//
// Read-only. It runs the same domain read the project page runs and prints the
// median of `runs` (default 5) after one warm-up, plus the size of each
// top-level field of the payload. Issue #411 has the numbers it produced.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { getProjectDetail } from "@/lib/domain/projects/queries";
import { systemPrincipal } from "@/lib/domain/principal";

const projectId = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
if (!projectId) {
  console.error(
    "Usage: tsx scripts/perf/measure-project-read.ts <projectId> [runs]",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 7 });
const db = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: [{ emit: "event", level: "query" }],
});
let statements = 0;
db.$on("query", () => {
  statements += 1;
});

const principal = systemPrincipal("perf measurement");
const kb = (value: unknown) =>
  Math.round((Buffer.byteLength(JSON.stringify(value) ?? "") / 1024) * 10) / 10;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function once() {
  statements = 0;
  const started = performance.now();
  const detail = await getProjectDetail(principal, projectId, db);
  const ms = performance.now() - started;
  if (!detail) throw new Error(`Project ${projectId} not found`);
  return { detail, ms, statements };
}

async function main() {
  await once(); // warm the pool and the query engine
  const results = [];
  for (let i = 0; i < runs; i += 1) results.push(await once());
  const { detail } = results[0];

  const fields = Object.entries(detail as unknown as Record<string, unknown>)
    .map(([key, value]) => ({ key, kb: kb(value) }))
    .filter((field) => field.kb >= 0.5)
    .sort((a, b) => b.kb - a.kb);

  // Inside each large list: how much each field of its rows adds up to.
  const nested: Record<string, Record<string, number>> = {};
  for (const { key } of fields.slice(0, 3)) {
    const rows = (detail as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) continue;
    const sums: Record<string, number> = {};
    for (const row of rows as Record<string, unknown>[]) {
      for (const [field, value] of Object.entries(row)) {
        sums[field] = (sums[field] ?? 0) + kb(value);
      }
    }
    nested[key] = Object.fromEntries(
      Object.entries(sums)
        .filter(([, size]) => size >= 1)
        .sort((a, b) => b[1] - a[1])
        .map(([field, size]) => [field, Math.round(size * 10) / 10]),
    );
  }

  console.log(
    JSON.stringify(
      {
        projectId,
        runs,
        medianMs: Math.round(median(results.map((r) => r.ms))),
        sqlStatements: median(results.map((r) => r.statements)),
        payloadKb: kb(detail),
        fields: Object.fromEntries(fields.map((f) => [f.key, f.kb])),
        nested,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
