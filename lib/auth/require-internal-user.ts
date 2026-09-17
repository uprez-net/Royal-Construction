import { auth } from "@clerk/nextjs/server";
import type { User } from "@prisma/client";
import { getUserByClerkId } from "@/lib/data/user";
import { leadListScope } from "@/lib/offer/access";

/**
 * Assert the caller is staff: signed in, with a role that may read every lead.
 *
 * For Server Actions that act across every record rather than on one lead or
 * offer (pipeline totals, the full projects export, campaign mail), where
 * authorizeLeadAccess has no id to check. "Staff" is canAccessLead's rule in
 * lib/offer/access.ts, read through leadListScope so the two cannot disagree:
 * anyone else sees only the leads assigned to them, and is refused here.
 */
export type InternalUserGuard =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly error: string };

// Same message for "not signed in" and "not staff", as requireAdminUser does.
const UNAUTHORIZED = "Unauthorized";

export async function requireInternalUser(): Promise<InternalUserGuard> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated || !clerkId) {
    return { ok: false, error: UNAUTHORIZED };
  }

  try {
    const user = await getUserByClerkId(clerkId);
    if (!user || leadListScope(user).assignedId !== null) {
      return { ok: false, error: UNAUTHORIZED };
    }
    return { ok: true, user };
  } catch (error) {
    // Fail closed. A lookup failure is not permission.
    console.error("[auth] Staff lookup failed:", error);
    return { ok: false, error: "Could not verify your permissions. Try again." };
  }
}
