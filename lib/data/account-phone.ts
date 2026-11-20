import "server-only";

import { revalidateTag } from "next/cache";

import { clerkClient } from "@/lib/auth";
import type {
  OwnPhoneIdentityPort,
  OwnPhoneIdentityReadPort,
} from "@/lib/domain/identity/phone-verification";
import { CACHE_PROFILES } from "@/types/cache";

/**
 * Keep Clerk's `publicMetadata.phone` in step with `User.phone`.
 *
 * The `user.updated` webhook copies that value onto `User.phone` whenever Clerk
 * changes anything about the account, so a stale copy there would put the old
 * number back the next time the person edits their name. `updateUserMetadata`
 * merges, so the role and anything else in public metadata are left alone.
 */
export const writeOwnPhoneToClerk: OwnPhoneIdentityPort = async ({
  clerkUserId,
  phone,
}) => {
  await clerkClient.users.updateUserMetadata(clerkUserId, {
    publicMetadata: { phone },
  });
};

/** Clerk's `publicMetadata.phone`, read fresh, or null when it has none. */
export const readOwnPhoneFromClerk: OwnPhoneIdentityReadPort = async (
  clerkUserId,
) => {
  const user = await clerkClient.users.getUser(clerkUserId);
  const phone = (user.publicMetadata as { phone?: unknown } | undefined)?.phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : null;
};

/** The cached user row, and the screens that show a staff member's phone. */
export function revalidateOwnPhone(clerkUserId: string): void {
  revalidateTag(`user-${clerkUserId}`, CACHE_PROFILES.MEDIUM);
  revalidateTag("site-managers", CACHE_PROFILES.MEDIUM);
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
}
