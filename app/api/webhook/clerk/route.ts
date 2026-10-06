import { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { UserJSON } from "@clerk/backend";
import { createUser, deleteUser, updateUser } from "@/lib/data/user";
import { Role } from "@prisma/client";
import { updateUserMetadata } from "@/lib/auth";
import { errorResponse, successResponse } from "@/utils/validators";
import { randomPhoneNumberGenerator } from "@/utils/generator";

/** The user's primary Clerk phone number, or undefined when there is none. */
function primaryClerkPhone(user: UserJSON): string | undefined {
  const numbers = user.phone_numbers ?? [];
  const primary =
    numbers.find((number) => number.id === user.primary_phone_number_id)
    ?? numbers[0];
  return primary?.phone_number || undefined;
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

    switch (evt.type) {
      case "user.created": {
        const { email_addresses, first_name, last_name, id } = evt.data;

        const email = email_addresses[0]?.email_address;
        // `User.phone` is required and unique, and most accounts reach Clerk
        // with no number, so a placeholder stands in until someone sets one.
        const phone = primaryClerkPhone(evt.data) ?? randomPhoneNumberGenerator();
        const fullName = [first_name, last_name].filter(Boolean).join(" ");
        const newUser = await createUser(fullName, email, id, phone);
        await updateUserMetadata(id, {
          publicMetadata: {
            role: newUser.role,
            ...((newUser.customerId && { customerId: newUser.customerId }) ||
              {}),
          },
          privateMetadata: {
            applicationUserId: newUser.userId,
          },
        });
        return successResponse({ message: "User created" });
      }

      case "user.updated": {
        const {
          public_metadata,
          email_addresses: updatedEmailAddresses,
          first_name: updatedFirstName,
          last_name: updatedLastName,
          id: updatedId,
        } = evt.data;

        const updatedEmail = updatedEmailAddresses[0]?.email_address;
        const role = (public_metadata?.role as Role) || Role.GUEST;

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
          phone: primaryClerkPhone(evt.data),
          role,
        });

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
