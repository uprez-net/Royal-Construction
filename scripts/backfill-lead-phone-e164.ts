// One-time backfill: fill Lead.phoneE164 for leads created before issue #333.
//
// Inbound WhatsApp messages are matched to a lead on phoneE164, exactly. The
// migration that added the column left it NULL for every existing lead, and
// until this runs a customer replying from a number already on a lead lands in
// the unmatched review queue instead of on their lead. Nothing is lost — the
// queue keeps it — but somebody has to file it by hand.
//
// The E.164 value comes from the same normaliser every lead write path uses
// (lib/domain/leads/whatsapp/phone.ts), so there is no second copy of "what a
// usable number is" here.
//
// Reported, not guessed:
//   - INVALID: the raw phone does not normalise. The column stays NULL, the
//     WhatsApp action stays disabled with its reason, and the list below says
//     which leads need their number corrected.
//   - SHARED: several leads normalise to the same number. Each still gets its
//     own E.164 — the inbound matcher treats more than one match as ambiguous
//     and holds the message for a person, which is the safe outcome — but the
//     list is printed so the office can merge or correct duplicates.
//
// Numbers are masked to their last three digits in the output: this script's
// log is not the place for a client list.
//
// Run: pnpm whatsapp:backfill-phones
// Add --commit to write; the default is a dry run.
//
// Idempotent: a lead whose stored value already matches is left alone, and a
// lead whose phone no longer normalises has a stale value cleared.

import "dotenv/config";

import {
  leadPhoneE164,
  normaliseLeadPhone,
} from "@/lib/domain/leads/whatsapp/phone";
import prisma from "@/lib/prisma";

const COMMIT = process.argv.includes("--commit");

function mask(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length <= 3 ? "***" : `…${digits.slice(-3)}`;
}

async function main() {
  console.log(
    COMMIT ? "Backfilling Lead.phoneE164…" : "DRY RUN — pass --commit to write",
  );

  const leads = await prisma.lead.findMany({
    orderBy: { id: "asc" },
    select: { id: true, phone: true, phoneE164: true },
  });
  console.log(`  ${leads.length} lead(s) found`);

  let normalised = 0;
  let unchanged = 0;
  let cleared = 0;
  const invalid: { id: number; reason: string; masked: string }[] = [];
  const byNumber = new Map<string, number[]>();

  for (const lead of leads) {
    const next = leadPhoneE164(lead.phone);
    if (next) byNumber.set(next, [...(byNumber.get(next) ?? []), lead.id]);
    if (!next && lead.phone.trim()) {
      const result = normaliseLeadPhone(lead.phone);
      invalid.push({
        id: lead.id,
        masked: mask(lead.phone),
        reason: result.usable ? "" : result.reason,
      });
    }

    if (next === lead.phoneE164) {
      unchanged++;
      continue;
    }
    if (next) normalised++;
    else cleared++;

    if (COMMIT) {
      await prisma.lead.update({
        data: { phoneE164: next },
        where: { id: lead.id },
      });
    }
  }

  const shared = [...byNumber.entries()].filter(([, ids]) => ids.length > 1);

  console.log("");
  console.log(
    `  ${normalised} lead(s) ${COMMIT ? "normalised" : "would be normalised"}`,
  );
  console.log(`  ${unchanged} already up to date`);
  if (cleared > 0) {
    console.log(
      `  ${cleared} stale value(s) ${COMMIT ? "cleared" : "would be cleared"} (phone no longer normalises or is empty)`,
    );
  }

  if (invalid.length > 0) {
    console.log("");
    console.log(
      `  INVALID — ${invalid.length} lead(s) with a phone that does not normalise (left NULL):`,
    );
    for (const entry of invalid) {
      console.log(`    lead #${entry.id} (${entry.masked})`);
    }
  }

  if (shared.length > 0) {
    console.log("");
    console.log(
      `  SHARED — ${shared.length} number(s) on more than one lead. Inbound messages from these are held for review as ambiguous:`,
    );
    for (const [number, ids] of shared) {
      console.log(
        `    ${mask(number)}: leads ${ids.map((id) => `#${id}`).join(", ")}`,
      );
    }
  }

  if (!COMMIT) console.log("\n  nothing written — re-run with --commit");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
