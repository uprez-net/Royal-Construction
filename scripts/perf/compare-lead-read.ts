// Checks that the SQL lead read returns exactly what Prisma's include returns,
// for every lead in the database: every field, every list order, and every
// value's type (a Date and an ISO string, or a Decimal and a number, tag
// differently).
//
// Run: pnpm tsx scripts/perf/compare-lead-read.ts
//
// Read-only. Exits non-zero and prints the first differences when they do not
// match.

import "dotenv/config";
import { isDeepStrictEqual } from "node:util";

import { LEAD_ROW_INCLUDE, readLeadRows } from "@/lib/domain/leads/row-read";
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

/** The paths at which two tagged values differ, at most `limit` of them. */
function differences(a: unknown, b: unknown, path = "", limit = 10): string[] {
  if (isDeepStrictEqual(a, b)) return [];
  if (
    a
    && b
    && typeof a === "object"
    && typeof b === "object"
    && Array.isArray(a) === Array.isArray(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: string[] = [];
    for (const key of keys) {
      out.push(
        ...differences(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          `${path}.${key}`,
          limit - out.length,
        ),
      );
      if (out.length >= limit) break;
    }
    return out;
  }
  return [`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`];
}

async function main() {
  const viaPrisma = await prisma.lead.findMany({
    include: LEAD_ROW_INCLUDE,
    orderBy: { id: "asc" },
  });
  const ids = viaPrisma.map((lead) => lead.id);
  const viaSql = await readLeadRows(ids, prisma);
  const all = await readLeadRows("all", prisma);

  let mismatched = 0;
  for (const [index, expected] of viaPrisma.entries()) {
    const diff = differences(
      tag(expected),
      tag(viaSql[index]),
      `lead ${expected.id}`,
    );
    if (diff.length > 0) {
      mismatched += 1;
      if (mismatched <= 3) console.log(diff.join("\n"));
    }
  }
  if (all.length !== viaPrisma.length) {
    console.log(
      `"all" returned ${all.length} leads, Prisma ${viaPrisma.length}`,
    );
    mismatched += 1;
  }

  const counts = viaPrisma.reduce(
    (sum, lead) => ({
      history: sum.history + lead.history.length,
      emails: sum.emails + lead.emails.length,
      files: sum.files + lead.files.length,
      annotations: sum.annotations + lead.noteAnnotations.length,
      tasks: sum.tasks + lead.tasks.length,
      chatSessions: sum.chatSessions + lead.chatSessions.length,
    }),
    {
      history: 0,
      emails: 0,
      files: 0,
      annotations: 0,
      tasks: 0,
      chatSessions: 0,
    },
  );
  console.log(
    JSON.stringify({ leads: viaPrisma.length, ...counts, mismatched }),
  );
  if (mismatched > 0) process.exitCode = 1;
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
