import "server-only";

import { auth } from "@clerk/nextjs/server";

import prisma from "@/lib/prisma";
import { findUserByClerkId } from "@/lib/domain/identity/users";
import {
  anonymousPrincipal,
  systemPrincipal,
  userPrincipal,
  type DomainPrincipal,
} from "@/lib/domain/principal";

/**
 * No Clerk session at all. The callers that reach a `lib/data` write with no
 * session are the ones meant to: the public booking route, the inbound lead
 * webhook, the reminder crons. They act for the business rather than for a
 * person, and `attributionUserId` already answers null for them, so history is
 * recorded without being attributed to anyone.
 */
const NO_SESSION = systemPrincipal("request without a Clerk session");

/**
 * A Clerk session that could not be resolved to an application user.
 *
 * Deliberately NOT the system principal. `isInternalPrincipal` is true for
 * system, so falling back to it would turn "we could not tell who this is"
 * into full internal access — a Clerk outage or a missing user row would
 * become permission. Same reasoning as `resolveAdminGuard`: a lookup failure
 * is not permission.
 */
const UNIDENTIFIED = anonymousPrincipal("unresolved Clerk session");

/**
 * The principal behind the current request, for `lib/data` adapters.
 *
 * A route that takes a record id from an unauthenticated caller must not rely
 * on this: it has to resolve its own principal and prove the claim, the way
 * `app/api/graph/book-consultant/route.ts` does with its booking token.
 */
export async function currentLeadPrincipal(): Promise<DomainPrincipal> {
  let clerkId: string | null | undefined;
  try {
    ({ userId: clerkId } = await auth());
  } catch (error) {
    // `auth()` answers no userId for an unauthenticated request, so reaching
    // here means Clerk itself failed. Fail closed rather than guess.
    console.error("[current-principal] Clerk lookup failed", error);
    return UNIDENTIFIED;
  }
  if (!clerkId) return NO_SESSION;

  try {
    const user = await findUserByClerkId(clerkId, prisma);
    return user ? userPrincipal(user) : UNIDENTIFIED;
  } catch (error) {
    console.error("[current-principal] Could not resolve the caller", error);
    return UNIDENTIFIED;
  }
}
