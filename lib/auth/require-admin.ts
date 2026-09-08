import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/data/user";

/**
 * Assert the caller is an ADMIN, for code paths the middleware does not cover.
 *
 * `proxy.ts` gates `/admin(.*)` by matching `request.nextUrl.pathname`. That is
 * a NAVIGATION guard: it stops someone opening an admin page. It does not stop
 * an admin Server Action, because a Server Action POSTs to whatever URL the
 * browser is currently on — invoked from `/dashboard` the pathname is not
 * `/admin/*`, `isAdminRoute` is false, and the role check never runs.
 *
 * Same reasoning as `requireAdmin` in app/api/xero/connect/route.ts, which was
 * moved out of the middleware for the same reason. Any Server Action that
 * writes admin-scoped data has to check for itself.
 */
export type AdminGuard =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly error: string };

export async function requireAdminUser(): Promise<AdminGuard> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const user = await getUserByClerkId(clerkId);
    if (user?.role !== "ADMIN") {
      // Deliberately the same message for "not signed in" and "signed in but
      // not an admin" at the call site — a non-admin learning that a resource
      // exists and is admin-only is information they do not need.
      return { ok: false, error: "Unauthorized" };
    }
    return { ok: true, userId: user.id };
  } catch (error) {
    // Fail closed. A lookup failure is not permission.
    console.error("[auth] Admin lookup failed:", error);
    return { ok: false, error: "Could not verify your permissions. Try again." };
  }
}
