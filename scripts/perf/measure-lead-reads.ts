// Measures the lead reads: SQL statements, time and payload size, for the
// Prisma include they used to run and the SQL read they run now, side by side.
//
// Run: pnpm tsx scripts/perf/measure-lead-reads.ts [leadId] [runs]
//
// Read-only. Prints the median of `runs` (default 5) after one warm-up, and
// the size of what the screen receives: the rows after `mapLead`. The lead
// defaults to the one with the most history. The list read is composed
// here the way `getLeads` composes it (lib/data/leads.ts is server-only).

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { LEAD_ROW_INCLUDE, readLeadRows } from "@/lib/domain/leads/row-read";
import { mapLead } from "@/types/lead";

/** What every lead read included before: whole authors, sessions and files. */
const PRISMA_INCLUDE = {
  ...LEAD_ROW_INCLUDE,
  history: { orderBy: { actionDate: "asc" }, include: { author: true } },
  chatSessions: true,
  files: true,
} as const;

const runs = Number(process.argv[3] ?? 5);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 7 });
const db = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: [{ emit: "event", level: "query" }],
});
let statements = 0;
db.$on("query", () => {
  statements += 1;
});

const kb = (value: unknown) =>
  Math.round((Buffer.byteLength(JSON.stringify(value) ?? "") / 1024) * 10) / 10;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(name: string, read: () => Promise<unknown>) {
  await read(); // warm the pool and the query engine
  const results: { ms: number; statements: number; kb: number }[] = [];
  for (let i = 0; i < runs; i += 1) {
    statements = 0;
    const started = performance.now();
    const out = await read();
    results.push({ ms: performance.now() - started, statements, kb: kb(out) });
  }
  return {
    name,
    medianMs: Math.round(median(results.map((r) => r.ms))),
    sqlStatements: median(results.map((r) => r.statements)),
    payloadKb: results[0].kb,
  };
}

const where = { isArchived: false };
const pageArgs = {
  where,
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  take: 10,
};

async function main() {
  const leadId =
    Number(process.argv[2])
    || (
      await db.$queryRaw<{ id: number }[]>`
        SELECT l.id FROM "Lead" l
        ORDER BY (SELECT count(*) FROM "LeadHistory" h WHERE h."leadId" = l.id) DESC
        LIMIT 1`
    )[0].id;

  const rows = [
    await measure("list page, before", async () => {
      const items = await db.lead.findMany({
        ...pageArgs,
        include: PRISMA_INCLUDE,
      });
      const totalCount = await db.lead.count({ where });
      return { items: items.map((lead) => mapLead(lead)), totalCount };
    }),
    await measure("list page, after", async () => {
      const [page, totalCount] = await Promise.all([
        db.lead.findMany({ ...pageArgs, select: { id: true } }),
        db.lead.count({ where }),
      ]);
      const items = await readLeadRows(
        page.map((lead) => lead.id),
        db,
      );
      return { items: items.map((lead) => mapLead(lead)), totalCount };
    }),
    await measure("detail, before", async () => {
      const lead = await db.lead.findUnique({
        where: { id: leadId },
        include: PRISMA_INCLUDE,
      });
      return lead && mapLead(lead);
    }),
    await measure("detail, after", async () => {
      const [lead] = await readLeadRows([leadId], db);
      return lead && mapLead(lead);
    }),
    await measure("all leads, before", async () =>
      (await db.lead.findMany({ include: PRISMA_INCLUDE })).map((lead) =>
        mapLead(lead),
      ),
    ),
    await measure("all leads, after", async () =>
      (await readLeadRows("all", db)).map((lead) => mapLead(lead)),
    ),
  ];
  console.log(JSON.stringify({ leadId, runs }));
  console.table(rows);
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
