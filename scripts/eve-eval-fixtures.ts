import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { EVAL_MARKER_PREFIX } from "@/evals/helpers/fixtures";

/**
 * Staging fixture maintenance for the Eve eval suite.
 *
 * This is the operator-side half of the suite and it runs on a different
 * machine from `eve:eval:staging`. The evaluator never needs a database
 * credential — it drives the agent over HTTP like a user. This script does,
 * because the things it answers cannot be seen from outside: is the fixture
 * set present, did the approved write leave the durable operation and audit
 * rows it was supposed to, and what is left over to clean up.
 *
 * Commands:
 *   status   resolve every configured fixture label and report what is there
 *   verify   check the durable rows behind recent eval writes
 *   reset    delete the disposable records eval runs created
 *
 * The one guard that matters: the connection string must be named in
 * `EVE_EVAL_FIXTURE_DATABASE_URL`. There is deliberately no fallback to
 * `DATABASE_URL`, because `DATABASE_URL` is whatever the shell happened to
 * have loaded, and `reset` deletes rows. Making the operator name the staging
 * database is the difference between a reset and an incident.
 */

type Command = "status" | "verify" | "reset";

const COMMANDS: readonly Command[] = ["status", "verify", "reset"];

/** How far back `verify` and `reset` look. */
const DEFAULT_WINDOW_HOURS = 24;

type FixtureLabel = {
  readonly env: string;
  readonly kind: "lead" | "offer" | "project" | "tradie" | "query";
  readonly name: string;
  readonly value: string | undefined;
};

function fixtureLabels(): readonly FixtureLabel[] {
  const read = (env: string) => process.env[env]?.trim() || undefined;
  return [
    {
      env: "EVE_EVAL_LEAD_LABEL",
      kind: "lead",
      name: "lead",
      value: read("EVE_EVAL_LEAD_LABEL"),
    },
    {
      env: "EVE_EVAL_WRITE_LEAD_LABEL",
      kind: "lead",
      name: "writeLead",
      value: read("EVE_EVAL_WRITE_LEAD_LABEL"),
    },
    {
      env: "EVE_EVAL_AMBIGUOUS_LEAD_QUERY",
      kind: "query",
      name: "ambiguousLeadQuery",
      value: read("EVE_EVAL_AMBIGUOUS_LEAD_QUERY"),
    },
    {
      env: "EVE_EVAL_OFFER_LABEL",
      kind: "offer",
      name: "offer",
      value: read("EVE_EVAL_OFFER_LABEL"),
    },
    {
      env: "EVE_EVAL_PROJECT_LABEL",
      kind: "project",
      name: "project",
      value: read("EVE_EVAL_PROJECT_LABEL"),
    },
    {
      env: "EVE_EVAL_MILESTONE_PROJECT_LABEL",
      kind: "project",
      name: "milestoneProject",
      value: read("EVE_EVAL_MILESTONE_PROJECT_LABEL"),
    },
    {
      env: "EVE_EVAL_COMPLIANCE_PROJECT_LABEL",
      kind: "project",
      name: "complianceProject",
      value: read("EVE_EVAL_COMPLIANCE_PROJECT_LABEL"),
    },
    {
      env: "EVE_EVAL_TRADIE_LABEL",
      kind: "tradie",
      name: "tradie",
      value: read("EVE_EVAL_TRADIE_LABEL"),
    },
    {
      env: "EVE_EVAL_SCHEDULE_TRADIE_LABEL",
      kind: "tradie",
      name: "scheduleTradie",
      value: read("EVE_EVAL_SCHEDULE_TRADIE_LABEL"),
    },
  ];
}

function createClient(): { prisma: PrismaClient; close: () => Promise<void> } {
  const connectionString = process.env.EVE_EVAL_FIXTURE_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "EVE_EVAL_FIXTURE_DATABASE_URL is required. It is deliberately separate from DATABASE_URL so a reset cannot land on the wrong database.",
    );
  }
  const pool = new Pool({
    allowExitOnIdle: true,
    connectionString,
    max: 3,
    ssl: { rejectUnauthorized: true },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return {
    close: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
    prisma,
  };
}

async function requireEvalUser(prisma: PrismaClient) {
  const clerkId = process.env.EVE_EVAL_USER_ID?.trim();
  if (!clerkId) {
    throw new Error(
      "EVE_EVAL_USER_ID is required so this script can scope to the dedicated eval user.",
    );
  }
  const user = await prisma.user.findUnique({
    select: { email: true, id: true, name: true, role: true },
    where: { clerkId },
  });
  if (!user) {
    throw new Error(
      `No application User row for Clerk id ${clerkId}. The eval user has not been synced through the Clerk webhook yet.`,
    );
  }
  return user;
}

function windowStart(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function status(prisma: PrismaClient): Promise<number> {
  const user = await requireEvalUser(prisma);
  console.log(
    `Eval user: ${user.name} <${user.email}> role=${user.role} id=${user.id}`,
  );
  console.log("");

  let missing = 0;
  let ambiguous = 0;

  for (const label of fixtureLabels()) {
    if (!label.value) {
      missing += 1;
      console.log(`  ○ ${label.name.padEnd(20)} unset (${label.env})`);
      continue;
    }

    const matches = await countMatches(prisma, label);
    // An ambiguity fixture is *supposed* to match more than one record; that
    // is the whole point of it. Everything else must resolve to exactly one,
    // or the case that uses it is asserting against a coin flip.
    const wanted = label.kind === "query" ? "2+" : "1";
    const ok = label.kind === "query" ? matches >= 2 : matches === 1;
    if (!ok) ambiguous += 1;
    console.log(
      `  ${ok ? "✓" : "✗"} ${label.name.padEnd(20)} "${label.value}" → ${matches} match(es), want ${wanted}`,
    );
  }

  console.log("");
  console.log(
    `${fixtureLabels().length - missing} configured, ${missing} unset (those cases skip), ${ambiguous} not resolving as expected.`,
  );
  return ambiguous === 0 ? 0 : 1;
}

async function countMatches(
  prisma: PrismaClient,
  label: FixtureLabel,
): Promise<number> {
  const contains = { contains: label.value!, mode: "insensitive" as const };
  switch (label.kind) {
    case "lead":
    case "query":
      return await prisma.lead.count({
        where: { isArchived: false, name: contains },
      });
    case "project":
      return await prisma.project.count({ where: { name: contains } });
    case "tradie":
      return await prisma.tradie.count({ where: { name: contains } });
    case "offer":
      // An offer has no single display name; the suite resolves one through
      // the lead it belongs to, which is how `search_offers` resolves it too.
      return await prisma.offer.count({
        where: { lead: { name: contains } },
      });
  }
}

async function verify(prisma: PrismaClient, hours: number): Promise<number> {
  const user = await requireEvalUser(prisma);
  const since = windowStart(hours);

  const tasks = await prisma.leadTask.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      completedAt: true,
      createdAt: true,
      id: true,
      lead: { select: { name: true } },
      notes: true,
      status: true,
    },
    where: {
      createdAt: { gte: since },
      notes: { contains: EVAL_MARKER_PREFIX },
    },
  });

  const operations = await prisma.agentOperation.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      action: true,
      createdAt: true,
      operationKey: true,
      status: true,
    },
    where: { createdAt: { gte: since }, ownerUserId: user.id },
  });

  const audits = await prisma.agentActionAudit.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      action: true,
      approvalOutcome: true,
      createdAt: true,
      status: true,
      targetId: true,
      targetType: true,
      toolName: true,
    },
    where: { createdAt: { gte: since }, ownerUserId: user.id },
  });

  console.log(`Last ${hours}h for ${user.email}:`);
  console.log("");
  console.log(`Marked lead tasks (${tasks.length}):`);
  for (const task of tasks) {
    console.log(
      `  #${task.id} lead="${task.lead.name}" status=${task.status} completedAt=${task.completedAt?.toISOString() ?? "—"} notes=${JSON.stringify(task.notes)}`,
    );
  }

  console.log("");
  console.log(`Agent operations (${operations.length}):`);
  for (const operation of operations) {
    console.log(
      `  ${operation.status.padEnd(9)} ${operation.action.padEnd(24)} ${operation.operationKey}`,
    );
  }

  console.log("");
  console.log(`Audit rows (${audits.length}):`);
  for (const audit of audits) {
    console.log(
      `  ${audit.status.padEnd(9)} ${audit.toolName.padEnd(22)} approval=${audit.approvalOutcome ?? "—"} target=${audit.targetType ?? "—"}:${audit.targetId ?? "—"}`,
    );
  }

  // Every completed approved write must have left both a durable operation
  // and an audit row. A write with no audit row is the case AGENTS.md calls
  // the access check that quietly stopped checking.
  const succeeded = operations.filter(
    (operation) => operation.status === "SUCCEEDED",
  ).length;
  const completedAudits = audits.filter(
    (audit) => audit.status === "SUCCEEDED",
  ).length;
  console.log("");
  if (succeeded > 0 && completedAudits === 0) {
    console.error(
      `✗ ${succeeded} succeeded operation(s) but no completed audit row. Investigate before trusting the run.`,
    );
    return 1;
  }
  console.log(
    `✓ ${succeeded} succeeded operation(s), ${completedAudits} completed audit row(s).`,
  );
  return 0;
}

async function reset(prisma: PrismaClient, hours: number): Promise<number> {
  const user = await requireEvalUser(prisma);
  const since = windowStart(hours);

  // Only rows this suite created, identified by the marker the evals stamp
  // into every disposable record. Nothing is matched by date alone: a fixture
  // lead created by hand on a busy afternoon must survive a reset.
  const tasks = await prisma.leadTask.deleteMany({
    where: { notes: { contains: EVAL_MARKER_PREFIX } },
  });

  // The idempotency and audit rows for this user's recent agent activity.
  // These are scoped to the dedicated eval user and to the window, because
  // they carry no marker of their own.
  const operations = await prisma.agentOperation.deleteMany({
    where: { createdAt: { gte: since }, ownerUserId: user.id },
  });
  const audits = await prisma.agentActionAudit.deleteMany({
    where: { createdAt: { gte: since }, ownerUserId: user.id },
  });
  const sessions = await prisma.agentSession.deleteMany({
    where: { createdAt: { gte: since }, ownerUserId: user.id },
  });

  console.log(`Reset for ${user.email} (last ${hours}h):`);
  console.log(`  lead tasks carrying ${EVAL_MARKER_PREFIX}: ${tasks.count}`);
  console.log(`  agent operations:                        ${operations.count}`);
  console.log(`  audit rows:                              ${audits.count}`);
  console.log(`  agent sessions:                          ${sessions.count}`);
  return 0;
}

function parseArgs(argv: readonly string[]): {
  command: Command;
  hours: number;
} {
  const command = argv[0] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    throw new Error(
      `Usage: eve:eval:fixtures <${COMMANDS.join("|")}> [--hours N]`,
    );
  }
  const index = argv.indexOf("--hours");
  const raw = index >= 0 ? Number(argv[index + 1]) : DEFAULT_WINDOW_HOURS;
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("--hours must be a positive number.");
  }
  return { command, hours: raw };
}

export async function runFixtureCommand(
  argv: readonly string[],
): Promise<number> {
  const { command, hours } = parseArgs(argv);
  const { close, prisma } = createClient();
  try {
    switch (command) {
      case "status":
        return await status(prisma);
      case "verify":
        return await verify(prisma, hours);
      case "reset":
        return await reset(prisma, hours);
    }
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runFixtureCommand(process.argv.slice(2));
  } catch (error) {
    process.exitCode = 1;
    console.error(
      error instanceof Error ? error.message : "Fixture command failed.",
    );
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
