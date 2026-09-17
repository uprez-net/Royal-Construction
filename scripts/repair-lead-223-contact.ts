/**
 * Repairs the contact details the ingestion bugs wrote onto lead 223.
 *
 * The phone lost its leading zero to a Number() conversion and the email was
 * overwritten with our own mailbox. Both are fixed in code as of the commit
 * this script ships with; this restores the one row that was already written
 * before the fix landed.
 *
 * No customer data is hardcoded here — the correct email and phone are passed
 * in at run time and never touch the repository or its history. Pull them
 * from the production Vercel logs for this message (search for
 * "Extracting lead from message" around the incident time) or from wherever
 * the original enquiry is on record.
 *
 * Uses `pg` directly rather than lib/prisma.ts for two reasons: that module
 * imports dotenv, which would quietly point this at staging, and its pool runs
 * `SET timezone` on connect, which leaks across clients on a PgBouncer
 * transaction pool.
 *
 * Refuses to run against anything but the production database host. Do NOT
 * run this with `--env-file=.env`: the production line in that file is
 * commented out, so it would hand you staging instead.
 *
 *   DATABASE_URL='<prod url>' \
 *   LEAD_EMAIL='<correct email>' \
 *   LEAD_PHONE='<correct phone>' \
 *   pnpm tsx scripts/repair-lead-223-contact.ts            # dry run
 *
 *   ...same env...  pnpm tsx scripts/repair-lead-223-contact.ts --apply
 *
 * Optionally set LEAD_ID to repair a different row with the same shape of
 * bug (default: 223, this incident's lead).
 */
import { Client } from "pg";

import { isOwnMailbox } from "@/lib/graph/mailbox";

/**
 * The production Neon endpoint, in full. An exact match rather than a
 * substring check — a substring can pass for a lookalike host that merely
 * contains it.
 */
const PRODUCTION_HOST =
  "ep-mute-recipe-a75smi81-pooler.ap-southeast-2.aws.neon.tech";

interface LeadRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

function productionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Pass the production URL explicitly.",
    );
  }

  const { host } = new URL(url);
  if (host !== PRODUCTION_HOST) {
    throw new Error(
      `DATABASE_URL points at ${host}, which is not production. ` +
        `This lead only exists in production; refusing to run.`,
    );
  }

  console.log(`target: ${host}`);
  return url;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. See the usage note at the top of this script.`,
    );
  }
  return value;
}

/**
 * Checked before the connection is opened, so a typo costs nothing.
 *
 * The own-mailbox rejection is the one that matters: writing our own address
 * into Lead.email is the original bug, and doing it by hand here would poison
 * the duplicate gate exactly the same way.
 */
function validatedEmail(): string {
  const email = requiredEnv("LEAD_EMAIL");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`LEAD_EMAIL ("${email}") is not a valid email address.`);
  }

  if (isOwnMailbox(email)) {
    throw new Error(
      `LEAD_EMAIL ("${email}") is one of our own mailboxes. Saving that as a ` +
        `lead's address is the bug this repair exists to undo.`,
    );
  }

  return email;
}

function validatedPhone(): string {
  const phone = requiredEnv("LEAD_PHONE");

  if (!/\d/.test(phone)) {
    throw new Error(`LEAD_PHONE ("${phone}") contains no digits.`);
  }

  return phone;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const leadId = Number(process.env.LEAD_ID ?? "223");

  if (!Number.isInteger(leadId) || leadId <= 0) {
    throw new Error(
      `LEAD_ID ("${process.env.LEAD_ID}") is not a positive integer.`,
    );
  }

  const correctEmail = validatedEmail();
  const correctPhone = validatedPhone();

  const client = new Client({ connectionString: productionUrl() });
  await client.connect();

  try {
    const { rows } = await client.query<LeadRow>(
      'SELECT id, name, email, phone FROM "Lead" WHERE id = $1',
      [leadId],
    );
    const lead = rows[0];

    if (!lead) {
      throw new Error(`Lead ${leadId} not found.`);
    }

    console.log("before:", lead);

    // Per field, and against whatever is in the row right now rather than a
    // value this script assumes — a field someone already hand-corrected
    // between the incident and this run should not be reconsidered "wrong".
    const repairs: Array<{
      column: "email" | "phone";
      from: string;
      to: string;
    }> = [];

    for (const field of [
      {
        column: "email" as const,
        current: lead.email ?? "",
        target: correctEmail,
      },
      {
        column: "phone" as const,
        current: lead.phone ?? "",
        target: correctPhone,
      },
    ]) {
      if (field.current === field.target) {
        console.log(`  ${field.column}: already "${field.target}".`);
      } else {
        repairs.push({
          column: field.column,
          from: field.current,
          to: field.target,
        });
      }
    }

    if (repairs.length === 0) {
      console.log("Nothing left to repair.");
      return;
    }

    for (const repair of repairs) {
      console.log(`  ${repair.column}: "${repair.from}" -> "${repair.to}"`);
    }

    if (!apply) {
      console.log("\nDry run. Re-run with --apply to write.");
      return;
    }

    // All fields move together or none do. Repairing the email and then
    // losing the race on the phone would leave the row in a state neither
    // the operator nor a re-run expects.
    const lost: string[] = [];
    await client.query("BEGIN");

    try {
      for (const repair of repairs) {
        // The WHERE clause repeats the value read above, so a concurrent edit
        // between that read and this write loses the race rather than being
        // clobbered.
        const updated = await client.query(
          `UPDATE "Lead" SET ${repair.column} = $1, "updatedAt" = now()
           WHERE id = $2 AND ${repair.column} = $3`,
          [repair.to, leadId, repair.from],
        );

        if (updated.rowCount === 0) {
          console.warn(`  ${repair.column}: changed under us, not written.`);
          lost.push(repair.column);
        }
      }

      if (lost.length > 0) {
        await client.query("ROLLBACK");
      } else {
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const { rows: after } = await client.query<LeadRow>(
      'SELECT id, name, email, phone FROM "Lead" WHERE id = $1',
      [leadId],
    );
    console.log("after:", after[0]);

    // A lost race is a conflict, not a partial success — a caller scripting
    // this (or a human glancing at the exit code) should not read a clean
    // exit as "the repair went through". Nothing was written: the whole
    // transaction rolled back.
    if (lost.length > 0) {
      throw new Error(
        `Lost the update race on: ${lost.join(", ")}. Rolled back, nothing written. ` +
          `Re-run to check current state.`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
