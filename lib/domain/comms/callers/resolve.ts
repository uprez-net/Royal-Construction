import { CallStaffTarget, CommsDirection, Prisma } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js";

import type { DomainDb } from "../../db";
import { leadPhoneE164 } from "../../leads/whatsapp/phone";
import { carrierNumberToE164 } from "../shared";
import { recordCallerAccess } from "./audit";
import {
  classifyCallerMatches,
  unknownCaller,
  type CallerMatch,
  type ResolvedCallerIdentity,
  type VoiceCallAuthority,
  type VoiceCallerPrincipal,
} from "./identity";

// The inbound caller → one VoiceCallerPrincipal.
//
// The number is the one the carrier put on the call when it arrived
// (`Call.customerNumber`, written from a signed webhook) — never one the
// caller speaks or the model repeats. It is matched against every phone Royal
// holds for a person, in the one normalised form:
//
//   User.phone            staff, and customer-portal accounts
//   Customer.phone        project owners
//   Lead.phoneE164/phone  the lead's client
//   Lead.secondaryPhone   the lead's second client
//   Tradie.phone          the directory
//
// Those columns are stored as typed ("0412 345 678", "+61412345678"), so the
// database narrows by the number's last digits and every candidate is then
// normalised here with the same helper the lead write path uses
// (`leadPhoneE164`). Only an exact E.164 match counts; classifyCallerMatches
// decides what the matches mean.
//
// Identification is by the carrier-provided number alone. That is a product
// decision for this business (see the comms runbook), and the reason the
// whole feature sits behind COMMS_AGENT_DISCLOSURE_ENABLED, default off.

/** More candidates than this for one number is not one person. */
const MAX_CANDIDATES = 40;

type CandidateRow = {
  source: string;
  id: string;
  phone: string | null;
  /** Lead.phoneE164, for lead rows; null elsewhere. */
  e164: string | null;
};

function nationalDigits(e164: string): string | null {
  const parsed = parsePhoneNumberFromString(e164);
  const national = parsed?.nationalNumber ?? null;
  return national && national.length >= 6 ? national : null;
}

/**
 * Every record whose phone could be this number: a cheap suffix match on the
 * digits. Exact matching happens in code, against the normaliser.
 */
async function candidateRows(
  db: DomainDb,
  e164: string,
  national: string,
): Promise<CandidateRow[]> {
  const suffix = `%${national}`;
  // An extension typed after the number ("0412 345 678 ext 12") is dropped
  // before the digits are compared, as the normaliser drops it too.
  const digits = (column: Prisma.Sql) =>
    Prisma.sql`regexp_replace(regexp_replace(${column}, '\\s*(ext\\.?|extension|x|#).*$', '', 'i'), '[^0-9]', '', 'g') LIKE ${suffix}`;
  return db.$queryRaw<CandidateRow[]>`
    SELECT 'user' AS source, "id" AS id, "phone" AS phone, NULL AS e164
      FROM "User" WHERE ${digits(Prisma.sql`"phone"`)}
    UNION ALL
    SELECT 'customer', "id", "phone", NULL FROM "Customer"
      WHERE "phone" IS NOT NULL AND ${digits(Prisma.sql`"phone"`)}
    UNION ALL
    SELECT 'lead', "id"::text, "phone", "phoneE164" FROM "Lead"
      WHERE "phoneE164" = ${e164} OR ${digits(Prisma.sql`"phone"`)}
    UNION ALL
    SELECT 'lead_secondary', "id"::text, "secondaryPhone", NULL FROM "Lead"
      WHERE "secondaryPhone" IS NOT NULL
        AND ${digits(Prisma.sql`"secondaryPhone"`)}
    UNION ALL
    SELECT 'tradie', "id", "phone", NULL FROM "Tradie"
      WHERE ${digits(Prisma.sql`"phone"`)}
    LIMIT ${MAX_CANDIDATES + 1}
  `;
}

/** The records whose stored phone normalises to exactly this number. */
export async function findCallerMatches(
  db: DomainDb,
  e164: string,
): Promise<CallerMatch[] | "too_many"> {
  const national = nationalDigits(e164);
  if (!national) return [];
  const rows = await candidateRows(db, e164, national);
  if (rows.length > MAX_CANDIDATES) return "too_many";

  // A lead's stored E.164 is what every other inbound matcher trusts (SMS,
  // WhatsApp, calls), so it counts as well as the raw value.
  const exact = rows.filter(
    (row) =>
      leadPhoneE164(row.phone) === e164
      || (row.source === "lead" && row.e164 === e164),
  );
  const ids = (source: string) =>
    exact.filter((row) => row.source === source).map((row) => row.id);
  const userIds = ids("user");
  const customerIds = ids("customer");
  const primaryLeadIds = ids("lead").map(Number);
  const secondaryLeadIds = ids("lead_secondary").map(Number);
  const tradieIds = ids("tradie");
  const leadIds = [...new Set([...primaryLeadIds, ...secondaryLeadIds])];

  const [users, customers, leads, tradies] = await Promise.all([
    userIds.length
      ? db.user.findMany({
          select: { customerId: true, id: true, name: true, role: true },
          where: { id: { in: userIds } },
        })
      : [],
    customerIds.length
      ? db.customer.findMany({
          select: { id: true, name: true },
          where: { id: { in: customerIds } },
        })
      : [],
    leadIds.length
      ? db.lead.findMany({
          select: {
            id: true,
            isArchived: true,
            name: true,
            project: {
              select: { customers: { select: { customerId: true } }, id: true },
            },
            secondaryName: true,
          },
          where: { id: { in: leadIds } },
        })
      : [],
    tradieIds.length
      ? db.tradie.findMany({
          select: { archivedAt: true, id: true, name: true },
          where: { id: { in: tradieIds } },
        })
      : [],
  ]);

  const matches: CallerMatch[] = [
    ...users.map((user) => ({
      customerId: user.customerId,
      id: user.id,
      kind: "user" as const,
      name: user.name,
      role: user.role,
    })),
    ...customers.map((customer) => ({
      id: customer.id,
      kind: "customer" as const,
      name: customer.name,
    })),
    ...tradies.map((tradie) => ({
      archived: tradie.archivedAt !== null,
      id: tradie.id,
      kind: "tradie" as const,
      name: tradie.name,
    })),
  ];
  for (const lead of leads) {
    const base = {
      archived: lead.isArchived,
      id: lead.id,
      kind: "lead" as const,
      projectCustomerIds:
        lead.project?.customers.map((owner) => owner.customerId) ?? [],
      projectId: lead.project?.id ?? null,
    };
    if (primaryLeadIds.includes(lead.id)) {
      matches.push({ ...base, personName: lead.name, via: "primary" });
    }
    if (secondaryLeadIds.includes(lead.id)) {
      matches.push({
        ...base,
        personName: lead.secondaryName ?? "",
        via: "secondary",
      });
    }
  }
  return matches;
}

/**
 * Resolve the caller on this call, and record how.
 *
 * Never throws for an unmatched or unclear caller — that is UNKNOWN, with a
 * reason in the audit row. It throws only when the database does, and the
 * adapter then treats the caller as UNKNOWN too.
 */
export async function resolveVoiceCaller(
  authority: VoiceCallAuthority,
  input: { readonly enabled: boolean },
  db: DomainDb,
): Promise<VoiceCallerPrincipal> {
  const principal = (
    identity: ResolvedCallerIdentity,
    callerNumber: string | null,
  ): VoiceCallerPrincipal => ({
    callId: authority.callId,
    callerNumber: identity.class === "unknown" ? null : callerNumber,
    identity,
    kind: "voice-caller",
    verification: identity.class === "unknown" ? null : "caller_id",
  });

  // Switched off: no lookup at all, and nothing to audit.
  if (!input.enabled) return principal(unknownCaller("disabled"), null);

  const call = await db.call.findUnique({
    select: {
      customerNumber: true,
      direction: true,
      providerCallId: true,
      staffTarget: true,
    },
    where: { id: authority.callId },
  });
  // An inbound call, or Mili's own briefing call to the owner line: there
  // the number is the one Royal dialled, which is at least as good as the
  // one a carrier put on an inbound call.
  const answerable =
    call?.direction === CommsDirection.INBOUND
    || (call?.direction === CommsDirection.OUTBOUND
      && call.staffTarget === CallStaffTarget.AGENT);
  if (
    !call
    || !answerable
    || call.providerCallId !== authority.providerCallId
  ) {
    // No audit row: there may be no call to hang it on.
    return principal(unknownCaller("not_inbound"), null);
  }

  const e164 = carrierNumberToE164(call.customerNumber);
  let identity: ResolvedCallerIdentity;
  if (!e164) {
    identity = unknownCaller("withheld");
  } else {
    const matches = await findCallerMatches(db, e164);
    identity =
      matches === "too_many"
        ? unknownCaller("ambiguous")
        : classifyCallerMatches(matches);
  }

  const resolved = principal(identity, e164);
  await recordCallerAccess(
    resolved,
    {
      kind: "RESOLVED",
      outcome: identity.class === "unknown" ? identity.reason : "matched",
      recordIds: recordIdsOf(identity),
    },
    db,
  );
  return resolved;
}

function recordIdsOf(identity: ResolvedCallerIdentity): string[] {
  switch (identity.class) {
    case "admin":
    case "site_manager":
      return [`user:${identity.userId}`];
    case "tradie":
      return [`tradie:${identity.tradieId}`];
    case "client":
      return [
        ...identity.customerIds.map((id) => `customer:${id}`),
        ...identity.leadIds.map((id) => `lead:${id}`),
      ];
    case "unknown":
      return [];
  }
}
