// Prints a type-tagged snapshot of the project detail read, so two versions of
// the read (for example two relation load strategies) can be diffed exactly:
// a Date and an ISO string, or a Decimal and a number, tag differently.
//
// Run: pnpm tsx scripts/perf/compare-project-read.ts <out.json> <projectId>...

import "dotenv/config";
import { writeFileSync } from "node:fs";

import { getProjectDetail } from "@/lib/domain/projects/queries";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

function tag(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(tag);
  if (typeof value === "object") {
    const ctor = (value as object).constructor?.name;
    if (ctor && ctor !== "Object") return { [`$${ctor}`]: String(value) };
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, tag(v)]),
    );
  }
  return { [`$${typeof value}`]: value };
}

/** With no ids: the five busiest projects and the emptiest one. */
async function defaultIds() {
  const rows = await prisma.project.findMany({
    select: {
      id: true,
      _count: {
        select: { milestones: true, tradieSchedules: true, activityLogs: true },
      },
    },
  });
  const weight = (row: (typeof rows)[number]) =>
    row._count.milestones
    + row._count.tradieSchedules
    + row._count.activityLogs;
  rows.sort((a, b) => weight(b) - weight(a));
  return [...rows.slice(0, 5), ...rows.slice(-1)].map((row) => row.id);
}

async function main() {
  const [out, ...given] = process.argv.slice(2);
  const ids = given.length > 0 ? given : await defaultIds();
  const principal = systemPrincipal("read comparison");
  const snapshot: Record<string, unknown> = {};
  for (const id of ids) {
    snapshot[id] = tag(await getProjectDetail(principal, id, prisma));
  }
  writeFileSync(out, JSON.stringify(snapshot, null, 1));
  console.log(`wrote ${ids.length} projects to ${out}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // lib/prisma's pool keeps the process alive otherwise.
    process.exit();
  });
