// Pre-launch audit: which phone numbers would Mili not resolve to one caller?
//
// Before COMMS_AGENT_DISCLOSURE_ENABLED is switched on (issue #528), run this
// against the production database. It takes every phone Royal holds for a
// person — User, Customer, Lead (primary and secondary) and Tradie — normalises
// each with the same helper the resolver uses, and runs every number held by
// more than one record through the resolver's own rule
// (lib/domain/comms/callers), so what it prints is exactly what a call from
// that number would get.
//
//   AMBIGUOUS    two people or two roles share it: the caller gets message
//                taking until a person corrects the records. Nothing here
//                picks a winner.
//   UNSUPPORTED  a GUEST, or a portal account with no customer link.
//   INACTIVE     only archived records hold it.
//   COMBINED     several client records judged one person (a customer and
//                their lead, a repeat enquiry under the same name). Printed so
//                the office can check the rule's judgement.
//
// Read-only. Numbers are masked, and records are shown by kind and id only:
// this log is not the place for a client list.
//
// Run: pnpm comms:audit-caller-phones

import "dotenv/config";

import { classifyCallerMatches } from "@/lib/domain/comms/callers/identity";
import { findCallerMatches } from "@/lib/domain/comms/callers/resolve";
import { maskNumber } from "@/lib/domain/comms/shared";
import { leadPhoneE164 } from "@/lib/domain/leads/whatsapp/phone";
import prisma from "@/lib/prisma";

async function main() {
  const [users, customers, leads, tradies] = await Promise.all([
    prisma.user.findMany({ select: { id: true, phone: true } }),
    prisma.customer.findMany({
      select: { id: true, phone: true },
      where: { phone: { not: null } },
    }),
    prisma.lead.findMany({
      select: { id: true, phone: true, phoneE164: true, secondaryPhone: true },
    }),
    prisma.tradie.findMany({ select: { id: true, phone: true } }),
  ]);

  const holders = new Map<string, Set<string>>();
  const hold = (raw: string | null | undefined, record: string) => {
    const e164 = leadPhoneE164(raw);
    if (!e164) return;
    holders.set(e164, (holders.get(e164) ?? new Set()).add(record));
  };
  for (const u of users) hold(u.phone, `user:${u.id}`);
  for (const c of customers) hold(c.phone, `customer:${c.id}`);
  for (const l of leads) {
    hold(l.phoneE164 ?? l.phone, `lead:${l.id}`);
    hold(l.secondaryPhone, `lead:${l.id}:secondary`);
  }
  for (const t of tradies) hold(t.phone, `tradie:${t.id}`);

  const shared = [...holders.entries()].filter(([, set]) => set.size > 1);
  const counts = { ambiguous: 0, combined: 0, inactive: 0, unsupported: 0 };
  console.log(
    `${holders.size} distinct numbers on file; ${shared.length} held by more than one record.\n`,
  );

  for (const [e164] of shared) {
    const matches = await findCallerMatches(prisma, e164);
    if (matches === "too_many") {
      counts.ambiguous += 1;
      console.log(`AMBIGUOUS    ${maskNumber(e164)}  (too many records)`);
      continue;
    }
    const identity = classifyCallerMatches(matches);
    const records = matches
      .map((m) =>
        m.kind === "user"
          ? `user:${m.id} (${m.role})`
          : m.kind === "lead"
            ? `lead:${m.id}${m.via === "secondary" ? " secondary" : ""}${m.archived ? " archived" : ""}`
            : m.kind === "tradie"
              ? `tradie:${m.id}${m.archived ? " archived" : ""}`
              : `customer:${m.id}`,
      )
      .join(", ");
    if (identity.class === "unknown") {
      const label = identity.reason.toUpperCase().padEnd(12);
      if (identity.reason === "ambiguous") counts.ambiguous += 1;
      if (identity.reason === "unsupported") counts.unsupported += 1;
      if (identity.reason === "inactive") counts.inactive += 1;
      console.log(`${label} ${maskNumber(e164)}  ${records}`);
    } else if (identity.class === "client") {
      counts.combined += 1;
      console.log(`COMBINED     ${maskNumber(e164)}  ${records}`);
    }
  }

  console.log(
    `\n${counts.ambiguous} ambiguous, ${counts.unsupported} unsupported, ${counts.inactive} inactive, ${counts.combined} combined into one client.`,
  );
  if (counts.ambiguous > 0) {
    console.log(
      "Ambiguous numbers get message taking only. Correct or merge the records above if those callers should be recognised.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
