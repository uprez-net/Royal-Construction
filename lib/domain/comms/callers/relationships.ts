import { Role } from "@prisma/client";

import { leadListScope } from "../../access/leads";
import type { DomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import { leadPhoneE164 } from "../../leads/whatsapp/phone";
import { userPrincipal, type UserPrincipal } from "../../principal";
import type { VoiceCallerPrincipal } from "./identity";

// The relationship a voice read rests on, read again every time.
//
// A caller was resolved once, at the start of the call. Every briefing and
// lookup re-reads the record that gave them access — the user is still that
// role and still holds that number, the tradie is still in the directory, the
// project is still theirs — so a change made mid-call, or a stale resolution,
// narrows what Mili may say instead of carrying it on.
//
// A refusal here is a DomainAuthorizationError with a message that names no
// record: the adapter turns it into "message taking", never into an answer.

const NOT_THIS_CALLER =
  "This caller's access could not be confirmed, so nothing was looked up.";

/**
 * A verified staff caller as the `UserPrincipal` the existing scopes read.
 *
 * Not a blind conversion: the user is read again, must still hold exactly the
 * role the call resolved to, and must still have the carrier-provided number
 * on their record. Only then do `projectManageScope`, `getProjectFinancials`
 * and the rest apply to them exactly as they would in the app.
 */
export async function currentVoiceStaff(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
): Promise<UserPrincipal> {
  const identity = caller.identity;
  if (identity.class !== "admin" && identity.class !== "site_manager") {
    throw new DomainAuthorizationError(NOT_THIS_CALLER);
  }
  const role = identity.class === "admin" ? Role.ADMIN : Role.SITE_MANAGER;
  const user = await db.user.findUnique({
    select: { customerId: true, id: true, phone: true, role: true },
    where: { id: identity.userId },
  });
  if (
    !user
    || user.role !== role
    || !caller.callerNumber
    || leadPhoneE164(user.phone) !== caller.callerNumber
  ) {
    throw new DomainAuthorizationError(NOT_THIS_CALLER);
  }
  return userPrincipal(user);
}

/** A verified tradie caller: still in the directory, still on that number. */
export async function currentVoiceTradie(
  caller: VoiceCallerPrincipal,
  db: DomainDb,
): Promise<{ readonly id: string }> {
  const identity = caller.identity;
  if (identity.class !== "tradie") {
    throw new DomainAuthorizationError(NOT_THIS_CALLER);
  }
  const tradie = await db.tradie.findUnique({
    select: { archivedAt: true, id: true, phone: true },
    where: { id: identity.tradieId },
  });
  if (
    !tradie
    || tradie.archivedAt !== null
    || !caller.callerNumber
    || leadPhoneE164(tradie.phone) !== caller.callerNumber
  ) {
    throw new DomainAuthorizationError(NOT_THIS_CALLER);
  }
  return { id: tradie.id };
}

/** `leadListScope` for a re-checked staff caller, as a `where` fragment. */
export function leadScopeWhere(principal: UserPrincipal) {
  const scope = leadListScope(principal);
  return scope.assignedId === null ? {} : { assignedId: scope.assignedId };
}

/**
 * A verified client caller's own records, as a project filter.
 *
 * Their projects are the ones a matched customer owns (any position on the
 * contract) or a matched lead became — resolved in the database, never from
 * an id anybody on the call supplied.
 */
export function clientProjectWhere(caller: VoiceCallerPrincipal) {
  const identity = caller.identity;
  if (identity.class !== "client") {
    throw new DomainAuthorizationError(NOT_THIS_CALLER);
  }
  return {
    OR: [
      {
        customers: {
          some: { customerId: { in: [...identity.customerIds] } },
        },
      },
      { leadId: { in: [...identity.leadIds] } },
    ],
  };
}
