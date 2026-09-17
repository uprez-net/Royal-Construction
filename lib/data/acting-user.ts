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
  } catch {
    return null;
  }
}
