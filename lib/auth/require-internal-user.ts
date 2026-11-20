import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import { getUserByClerkId } from "@/lib/data/user";
import { isInternalRole } from "@/lib/domain/principal";
import { leadListScope } from "@/lib/offer/access";

/**
 * Two guards for a Server Action that acts across every record rather than on
 * one lead or offer, where `authorizeLeadAccess` has no id to check.
 *
 * - `requireInternalUser` — **the office**: signed in, with a role that may read
 *   every lead. Despite the name it is not "any staff": a site manager is
 *   refused. Use it for the sales side — pipeline totals, the full projects
 *   export (it carries budgets), campaign mail, lead tasks.
 * - `requireStaffUser` — **any staff, site managers included**: signed in as
 *   ADMIN, SITE_MANAGER or GUEST. Use it only for work a site manager does and
 *   whose domain command applies the per-project rule itself (booking
 *   reminders, rescheduling, a tradie's bookings). It proves who is asking and
 *   nothing more.
 *
 * "Office" is canAccessLead's rule in lib/offer/access.ts, read through
 * leadListScope so the two cannot disagree: anyone else sees only the leads
 * assigned to them, and is refused here.
 */
export type InternalUserGuard =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly error: string };

// Same message for "not signed in" and "not allowed", as requireAdminUser does.
const UNAUTHORIZED = "Unauthorized";

async function requireUser(
  allowed: (user: User) => boolean,
): Promise<InternalUserGuard> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated || !clerkId) {
    return { ok: false, error: UNAUTHORIZED };
  }

  try {
    const user = await getUserByClerkId(clerkId);
    if (!user || !allowed(user)) {
      return { ok: false, error: UNAUTHORIZED };
    }
    return { ok: true, user };
  } catch (error) {
    // Fail closed. A lookup failure is not permission.
    console.error("[auth] Staff lookup failed:", error);
    return {
      ok: false,
      error: "Could not verify your permissions. Try again.",
    };
  }
}

/** The office: may read every lead. Refuses a site manager. */
export async function requireInternalUser(): Promise<InternalUserGuard> {
  return requireUser((user) => leadListScope(user).assignedId === null);
}

/** Any staff, a site manager included. See the module comment. */
export async function requireStaffUser(): Promise<InternalUserGuard> {
  return requireUser((user) => isInternalRole(user.role));
}
