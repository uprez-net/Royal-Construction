import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { createUser, deleteUser, updateUser } from "@/lib/data/user";
import { Role } from "@prisma/client";
import { updateUserMetadata } from "@/lib/auth";
import { errorResponse, successResponse } from "@/utils/validators";

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
                return NextResponse.json({ success: true, message: "User created" }, { status: 201 });
            }

            case "user.updated": {
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

                return NextResponse.json({ success: true, message: "User updated" }, { status: 200 });
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
                return NextResponse.json({ success: true, message: "User deleted" }, { status: 200 });
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
                return NextResponse.json({ success: true, message: "Organization invitation accepted" }, { status: 200 });
            }

            case "organizationInvitation.created":
                return NextResponse.json({ success: true, message: "Organization invitation created" }, { status: 200 });

            case "organizationInvitation.revoked":
                return NextResponse.json({ success: true, message: "Organization invitation revoked" }, { status: 200 });

            default:
                console.warn(`Unhandled event type: ${evt.type}`);
                return NextResponse.json({ success: true, message: "Event acknowledged but not processed" }, { status: 200 });
        }

    } catch (error) {
        console.error("Error verifying webhook:", error);
        return errorResponse("Failed to process webhook", {
            status: 500,
            code: "WEBHOOK_ERROR",
        });
    }
}