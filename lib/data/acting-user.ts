import { auth } from "@clerk/nextjs/server";

import { getUserByClerkIdCached } from "@/lib/data/user";

/**
 * The application user behind the current request, or null.
 *
 * Null is a normal answer, not a failure: crons, webhooks and the booking route
 * all write history with nobody signed in. Every caller stamps `authorId` only
 * when this returns one, so an unauthenticated write records the event without
 * attributing it to anyone.
 */
export async function resolveActingUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    if (!userId) return null;

    const user = await getUserByClerkIdCached(userId);
    return user?.id ?? null;
  } catch (error) {
    // Still null — attribution is not worth failing a save the operator asked
    // for — but never silent. `auth()` already returns no userId for an
    // unauthenticated request, so reaching here means Clerk or the user lookup
    // actually failed, and a signed-in mutation is about to write history with
    // no author. Without this line that looked identical to a cron.
    console.error("[acting-user] Could not resolve the acting user", error);
    return null;
  }
}
