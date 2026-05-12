import { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { createUser, deleteUser, updateUser } from "@/lib/data/user";
import { Role } from "@prisma/client";
import { updateUserMetadata } from "@/lib/auth";


export async function POST(request: NextRequest) {
    try {
        const evt = await verifyWebhook(request)
        if (!evt) {
            console.error("Invalid webhook event");
            console.dir(evt);
            return new Response("Invalid webhook", { status: 400 });
        }

        switch (evt.type) {
            case "user.created":
                const {
                    phone_numbers,
                    email_addresses,
                    first_name,
                    last_name,
                    id,
                } = evt.data;

                const email = email_addresses[0]?.email_address;
                const phone = phone_numbers[0]?.phone_number;

                const newUser = await createUser(`${first_name} ${last_name}`, email, id, phone);
                await updateUserMetadata(id, {
                    publicMetadata: {
                        role: newUser.role,
                        customerId: newUser.customerId,
                    },
                    privateMetadata: {
                        applicationUserId: newUser.userId,
                    }
                });
                return new Response("User created", { status: 200 });
            case "user.updated":
                // Handle user updated event
                const {
                    public_metadata,
                    phone_numbers: updatedPhoneNumbers,
                    email_addresses: updatedEmailAddresses,
                    first_name: updatedFirstName,
                    last_name: updatedLastName,
                    id: updatedId,
                } = evt.data;

                const updatedEmail = updatedEmailAddresses[0]?.email_address;
                const updatedPhone = updatedPhoneNumbers[0]?.phone_number;
                const role = public_metadata?.role as Role || Role.CUSTOMER;

                await updateUser(updatedId, {
                    name: `${updatedFirstName} ${updatedLastName}`,
                    email: updatedEmail,
                    phone: updatedPhone,
                    role,
                });

                return new Response("User updated", { status: 200 });
            case "user.deleted":
                const { id: deletedId } = evt.data;

                if (!deletedId) {
                    console.error("No user ID provided in user.deleted event");
                    return new Response("User ID missing", { status: 400 });
                }

                await deleteUser(deletedId);
                // Handle user deleted event
                return new Response("User deleted", { status: 200 });
            case "organizationInvitation.accepted":
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
                // Handle organization invitation accepted event
                return new Response("Organization invitation accepted", { status: 200 });
            case "organizationInvitation.created":
                // Handle organization invitation created event
                return new Response("Organization invitation created", { status: 200 });
            case "organizationInvitation.revoked":
                // Handle organization invitation revoked event
                return new Response("Organization invitation revoked", { status: 200 });
            default:
                console.warn(`Unhandled event type: ${evt.type}`);
        }

        return new Response("Webhook event not handled", { status: 200 });

    } catch (error) {
        console.error("Error verifying webhook:", error);
        return new Response("Error verifying webhook", { status: 400 });
    }
}