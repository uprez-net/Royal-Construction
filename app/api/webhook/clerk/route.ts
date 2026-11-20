import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { InvitationJSON, UserJSON } from "@clerk/backend";
import { createUser, deleteUser, updateUser } from "@/lib/data/user";
import { Role } from "@prisma/client";
import { clerkClient, updateUserMetadata } from "@/lib/auth";
import {
  acceptTeamInvitation,
  markTeamInvitationUsed,
  recordTeamInvitation,
  revokeRecordedTeamInvitation,
  roleForNewAccount,
  roleFromMetadata,
} from "@/lib/domain/identity/invitations";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators";
import { randomPhoneNumberGenerator } from "@/utils/generator";
import { CACHE_PROFILES } from "@/types/cache";

/**
 * The phone the team screen saved into `publicMetadata.phone`, or undefined.
 *
 * Team phones are kept in metadata, not as Clerk phone numbers, so this is the
 * only place a Clerk event carries one.
 */
function metadataPhone(user: UserJSON): string | undefined {
  const phone = (user.public_metadata as { phone?: unknown } | undefined)
    ?.phone;
  return typeof phone === "string" && phone.trim() ? phone.trim() : undefined;
}

/**
 * The phone and role Clerk holds now, not the ones this event carried.
 *
 * Clerk can deliver `user.updated` events late and out of order. Two quick
 * saves of someone's own number (a typo, then the fix) each write the
 * metadata and each fire an event; copying the first event's phone after the
 * second save would put the typo back on `User.phone` and drop its verified
 * badge. A role changed twice on the team screen is the same: the first
 * event arriving last would undo the second change. Reading Clerk's current
 * values makes every event write the latest, whichever order they arrive in.
 * If Clerk cannot be read, both are left alone rather than overwritten with
 * possibly stale ones.
 */
async function currentMetadata(
  clerkUserId: string,
): Promise<{ phone: string | undefined; role: Role | undefined } | null> {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const phone = (user.publicMetadata as { phone?: unknown } | undefined)
      ?.phone;
    return {
      phone:
        typeof phone === "string" && phone.trim() ? phone.trim() : undefined,
      role: roleFromMetadata(user.publicMetadata) ?? undefined,
    };
  } catch (error) {
    console.error(
      "[clerk-webhook] Could not read the current metadata; leaving the stored phone and role",
      error,
    );
    return null;
  }
}

/**
 * An application (not organization) invitation event.
 *
 * Clerk sends `invitation.created`, `.accepted` and `.revoked`, but
 * @clerk/backend's `WebhookEvent` union does not list them, so they are
 * recognised by name here rather than by a `case` the compiler would reject.
 */
type InvitationEvent = {
  type: "invitation.created" | "invitation.accepted" | "invitation.revoked";
  data: InvitationJSON & { expires_at?: number | null };
};

function invitationEvent(evt: {
  type: string;
  data: unknown;
}): InvitationEvent | null {
  return evt.type === "invitation.created"
    || evt.type === "invitation.accepted"
    || evt.type === "invitation.revoked"
    ? (evt as InvitationEvent)
    : null;
}

/**
 * How long Clerk keeps an invitation open when it does not say. Only an
 * invitation sent from Clerk's dashboard reaches here without our own record
 * (the app records its own when it sends one), and Clerk's default is 30 days.
 */
const CLERK_DEFAULT_INVITATION_DAYS = 30;

async function handleInvitationEvent({ type, data }: InvitationEvent) {
  switch (type) {
    case "invitation.created": {
      const role = roleFromMetadata(data.public_metadata);
      if (role) {
        await recordTeamInvitation(
          {
            clerkInvitationId: data.id,
            email: data.email_address,
            expiresAt: new Date(
              data.expires_at
                ?? data.created_at
                  + CLERK_DEFAULT_INVITATION_DAYS * 24 * 60 * 60 * 1000,
            ),
            role,
          },
          prisma,
        );
      }
      return successResponse({ message: "Invitation recorded" });
    }

    case "invitation.revoked":
      await revokeRecordedTeamInvitation(data.id, prisma);
      return successResponse({ message: "Invitation revoked" });

    case "invitation.accepted": {
      const changed = await acceptTeamInvitation(
        {
          clerkInvitationId: data.id,
          email: data.email_address,
          metadata: data.public_metadata,
        },
        prisma,
      );
      if (changed) {
        // Clerk's copy follows, so the next `user.updated` agrees with it.
        await updateUserMetadata(changed.clerkId, {
          publicMetadata: { role: changed.role },
        });
        revalidateTag(`user-${changed.clerkId}`, CACHE_PROFILES.MEDIUM);
      }
      return successResponse({ message: "Invitation accepted" });
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const evt = await verifyWebhook(request);
    if (!evt) {
      console.error("Invalid webhook event");
      return errorResponse("Invalid webhook signature", {
        status: 401,
        code: "INVALID_SIGNATURE",
      });
    }

    const invitation = invitationEvent(evt);
    if (invitation) return handleInvitationEvent(invitation);

    switch (evt.type) {
      case "user.created": {
        const { email_addresses, first_name, last_name, id } = evt.data;

        const email = email_addresses[0]?.email_address;
        // `User.phone` is required and unique, and most accounts reach Clerk
        // with no number, so a placeholder stands in until someone sets one.
        const phone = metadataPhone(evt.data) ?? randomPhoneNumberGenerator();
        const fullName = [first_name, last_name].filter(Boolean).join(" ");
        // The invited role: Clerk's copy from the invitation link, else our
        // record of an invitation to this address. This used to be GUEST for
        // everyone, written back over the invitation's role just below.
        const { role, invitationId } = await roleForNewAccount(
          { email, metadata: evt.data.public_metadata },
          prisma,
        );
        const newUser = await createUser(fullName, email, id, phone, role);
        if (invitationId) await markTeamInvitationUsed(invitationId, prisma);
        await updateUserMetadata(id, {
          publicMetadata: {
            role: newUser.role,
            ...((newUser.customerId && { customerId: newUser.customerId })
              || {}),
          },
          privateMetadata: {
            applicationUserId: newUser.userId,
          },
        });
        return successResponse({ message: "User created" });
      }

      case "user.updated": {
        const {
          email_addresses: updatedEmailAddresses,
          first_name: updatedFirstName,
          last_name: updatedLastName,
          id: updatedId,
        } = evt.data;

        const updatedEmail = updatedEmailAddresses[0]?.email_address;
        const current = await currentMetadata(updatedId);
        // No role in the metadata leaves the stored one alone. It used to mean
        // GUEST, so any update Clerk sent before `user.created` had written the
        // invited role back (they can arrive out of order) demoted the new
        // account to GUEST.
        const role = current?.role;

        // The phone used to be replaced with a fresh random number on every
        // Clerk update — a role change, a name edit, a new phone set from the
        // team screen — so whatever the office saved was wiped seconds later.
        // Only a number Clerk actually holds is copied; otherwise the stored
        // one is left alone. Same for an empty name.
        const updatedName = [updatedFirstName, updatedLastName]
          .filter(Boolean)
          .join(" ");
        await updateUser(updatedId, {
          name: updatedName || undefined,
          email: updatedEmail,
          phone: metadataPhone(evt.data) ? current?.phone : undefined,
          role,
        });
        // The role every guard reads comes from this cached row.
        revalidateTag(`user-${updatedId}`, CACHE_PROFILES.MEDIUM);

        return successResponse({ message: "User updated" });
      }

      case "user.deleted": {
        const { id: deletedId } = evt.data;

        if (!deletedId) {
          return errorResponse("User ID is required for deletion", {
            status: 400,
            code: "MISSING_USER_ID",
          });
        }

        await deleteUser(deletedId);
        return successResponse({ message: "User deleted" });
      }

      case "organizationInvitation.accepted": {
        const {
          role_name: invitationRoleName,
          user_id: invitationUserId,
          organization_id: invitationOrganizationId,
        } = evt.data;

        const updatedUser = await updateUser(invitationUserId, {
          role: invitationRoleName as Role,
        });
        await updateUserMetadata(invitationUserId, {
          publicMetadata: {
            role: updatedUser.role,
            organizationId: invitationOrganizationId,
          },
        });
        return successResponse({ message: "Organization invitation accepted" });
      }

      case "organizationInvitation.created":
        return successResponse({ message: "Organization invitation created" });

      case "organizationInvitation.revoked":
        return successResponse({ message: "Organization invitation revoked" });

      default:
        console.warn(`Unhandled event type: ${evt.type}`);
        return successResponse({ message: `Event type ${evt.type} received` });
    }
  } catch (error) {
    console.error("Error verifying webhook:", error);
    return errorResponse("Failed to process webhook", {
      status: 500,
      code: "WEBHOOK_ERROR",
    });
  }
}
