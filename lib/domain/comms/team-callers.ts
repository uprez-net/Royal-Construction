import type { Prisma, Role } from "@prisma/client";

import type { DomainDb } from "../db";
import { leadPhoneE164 } from "../leads/whatsapp/phone";
import type { CommsChannel } from "../ports/comms";
import { INTERNAL_ROLES } from "../principal";
import { OFFICE_MOBILE_LABEL } from "./team-phones";

// "That call was one of us": the numbers the team rings the business line
// from, and whose they are.
//
// A team member calling the office number is answered by Mili like anyone
// else, and with no lead behind the number it used to land on the leads
// page's Pending Calls/Messages as if a prospect had rung. It is not waiting
// to be filed onto a lead, so the pending list leaves it out, and the admin
// Phone & SMS page lists it under the person's name instead.
//
// The team is, in this order (the first name for a number wins):
//   - staff: a user with an internal role (ADMIN, SITE_MANAGER) and a phone
//     on their record, normalised like every other number here;
//   - the team's phones on Admin → Phone & SMS, by nickname;
//   - the office mobile (COMMS_STAFF_FORWARD_NUMBER).
//
// Filing, not disclosure. Mili's caller resolution (./callers) decides what a
// caller may be told and deliberately ignores the team phones; this only
// decides which list a call is shown on, so a team phone counts.

export type TeamCallerKind = "staff" | "team_phone" | "office_mobile";

export type TeamCaller = {
  readonly e164: string;
  readonly name: string;
  readonly kind: TeamCallerKind;
  /** Staff only: their role, for the label ("Site manager"). */
  readonly role: Role | null;
};

/** Every number the team calls from, each once, staff first. */
export async function listTeamCallers(
  db: DomainDb,
  context: {
    readonly channel?: Pick<CommsChannel, "staffForwardNumber"> | null;
  } = {},
): Promise<TeamCaller[]> {
  const [users, phones] = await Promise.all([
    db.user.findMany({
      orderBy: { name: "asc" },
      select: { name: true, phone: true, role: true },
      where: { role: { in: [...INTERNAL_ROLES] } },
    }),
    db.commsTeamPhone.findMany({
      orderBy: [{ nickname: "asc" }, { createdAt: "asc" }],
      select: { e164: true, nickname: true },
    }),
  ]);
  const byNumber = new Map<string, TeamCaller>();
  const add = (caller: TeamCaller) => {
    if (!byNumber.has(caller.e164)) byNumber.set(caller.e164, caller);
  };
  for (const user of users) {
    const e164 = leadPhoneE164(user.phone);
    if (e164) add({ e164, kind: "staff", name: user.name, role: user.role });
  }
  for (const phone of phones) {
    add({
      e164: phone.e164,
      kind: "team_phone",
      name: phone.nickname,
      role: null,
    });
  }
  const office = context.channel?.staffForwardNumber ?? null;
  if (office) {
    add({
      e164: office,
      kind: "office_mobile",
      name: OFFICE_MOBILE_LABEL,
      role: null,
    });
  }
  return [...byNumber.values()];
}

/** Calls from none of these numbers. Spread into a `where`. */
export function notFromTeam(
  callers: readonly TeamCaller[],
): Prisma.CallWhereInput {
  return callers.length === 0
    ? {}
    : { customerNumber: { notIn: callers.map((caller) => caller.e164) } };
}

/** Calls from one of these numbers. Spread into a `where`. */
export function fromTeam(
  callers: readonly TeamCaller[],
): Prisma.CallWhereInput {
  return { customerNumber: { in: callers.map((caller) => caller.e164) } };
}
