import { auth } from "@clerk/nextjs/server";

import prisma from "@/lib/prisma";
import { findUserByClerkId } from "@/lib/domain/identity/users";

/**
 * Assert the caller is an ADMIN, for code paths the middleware does not cover.
 *
 * `proxy.ts` gates `/admin(.*)` by matching `request.nextUrl.pathname`. That is
 * a NAVIGATION guard: it stops someone opening an admin page. It does not stop
 * an admin Server Action, because a Server Action POSTs to whatever URL the
 * browser is currently on — invoked from `/dashboard` the pathname is not
 * `/admin/*`, `isAdminRoute` is false, and the role check never runs. Confirmed
 * against the running app: posting an admin save to `/dashboard` reaches the
 * action and executes it.
 *
 * Same reasoning as `requireAdmin` in app/api/xero/connect/route.ts, which was
 * moved out of the middleware for the same reason. Any Server Action that
 * writes admin-scoped data has to check for itself.
 */
export type AdminGuard =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly error: string };

// Deliberately the same message for "not signed in" and "signed in but not an
// admin": a non-admin learning that a resource exists and is admin-only is
// information they do not need.
const UNAUTHORIZED = "Unauthorized";
const LOOKUP_FAILED = "Could not verify your permissions. Try again.";

/**
 * The authorization decision, separated from the I/O that feeds it.
 *
 * Every staging user is an ADMIN, so the refusal branches cannot be reached by
 * signing in as somebody; keeping the decision pure is what makes them
 * testable at all — which is also why the lookup goes through the Node-safe
 * domain module rather than `lib/data/user.ts`. That adapter carries
 * `import "server-only"`, which throws outside a React bundler, so importing
 * it here took this whole module, and the test of the pure decision, down
 * with it. `proxy.ts` was moved off it for the same reason.
 */
export function resolveAdminGuard(
  clerkId: string | null | undefined,
  user: { readonly id: string; readonly role: string } | null,
): AdminGuard {
  if (!clerkId) {
    return { ok: false, error: UNAUTHORIZED };
  }
  if (!user || user.role !== "ADMIN") {
    return { ok: false, error: UNAUTHORIZED };
  }
  return { ok: true, userId: user.id };
}

export async function requireAdminUser(): Promise<AdminGuard> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return resolveAdminGuard(clerkId, null);
  }

  try {
    return resolveAdminGuard(clerkId, await findUserByClerkId(clerkId, prisma));
  } catch (error) {
    // Fail closed. A lookup failure is not permission.
    console.error("[auth] Admin lookup failed:", error);
    return { ok: false, error: LOOKUP_FAILED };
  }
}
