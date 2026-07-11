"use server";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { Role } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";

/**
 * Creates a new application user.
 *
 * If the assigned role is `CUSTOMER`, a corresponding customer record is also
 * created and linked to the newly created user.
 *
 * @param name - User's full name.
 * @param email - User's email address.
 * @param clerkId - Unique Clerk user identifier.
 * @param phone - User's phone number.
 * @param role - User role. Defaults to `GUEST`.
 * @returns An object containing the operation result, created user ID,
 * optional customer ID and assigned role.
 *
 * @throws Re-throws any database errors encountered during creation.
 */
export async function createUser(name: string, email: string, clerkId: string, phone: string, role: Role = Role.GUEST) {
    try {
        let customerId: string | null = null;
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                clerkId,
                role,
                phone,
            }
        });

        if (role === Role.CUSTOMER) {
            const customer = await prisma.customer.create({
                data: {
                    email,
                    name,
                    phone,
                }
            });

            await prisma.user.update({
                where: { id: newUser.id },
                data: { customerId: customer.id },
            });
            customerId = customer.id;
        }

        return {
            success: true,
            message: "User created successfully",
            userId: newUser.id,
            customerId,
            role: newUser.role,
        };
    } catch (error) {
        console.error("Error creating user:", error);
        throw error;
    }
}

/**
 * Retrieves a user by their Clerk identifier.
 *
 * @param clerkId - Clerk user identifier.
 * @returns The matching user, or `null` if no user exists.
 *
 * @throws Re-throws any database errors encountered during retrieval.
 */
export async function getUserByClerkId(clerkId: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { clerkId },
        });
        return user;
    } catch (error) {
        console.error("Error fetching user by Clerk ID:", error);
        throw error;
    }
}

/**
 * Updates an existing application user.
 *
 * Only fields with defined values are updated. Undefined properties are
 * automatically ignored.
 *
 * If the user's role is changed to `CUSTOMER`, a corresponding customer
 * record is created and linked to the user.
 *
 * @param clerkId - Clerk user identifier.
 * @param updates - Partial collection of user properties to update.
 * @returns An object containing the operation result, updated user ID,
 * assigned role and optional customer ID.
 *
 * @throws Re-throws any database errors encountered during the update.
 */
export async function updateUser(clerkId: string, updates: Partial<{ name: string; email: string; phone: string; role: Role }>) {
    try {
        // Remove undefined fields
        let customerId: string | null = null;
        const filteredUpdates = Object.fromEntries(
            Object.entries(updates).filter(([, value]) => value !== undefined)
        );

        const user = await prisma.user.update({
            where: { clerkId },
            data: filteredUpdates,
        });

        if (updates.role === Role.CUSTOMER) {
            const customer = await prisma.customer.create({
                data: {
                    email: user.email,
                    name: user.name,
                    phone: user.phone,
                }
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { customerId: customer.id },
            });
            customerId = customer.id;
        }

        return {
            success: true,
            message: "User updated successfully",
            userId: user.id,
            role: user.role,
            customerId,
        };
    } catch (error) {
        console.error("Error updating user:", error);
        throw error;
    }
}

/**
 * Deletes a user by their Clerk identifier.
 *
 * @param clerkId - Clerk user identifier.
 * @returns An object indicating whether the deletion succeeded.
 *
 * @throws Re-throws any database errors encountered during deletion.
 */
export async function deleteUser(clerkId: string) {
    try {
        await prisma.user.delete({
            where: { clerkId },
        });
        return {
            success: true,
            message: "User deleted successfully",
        };
    } catch (error) {
        console.error("Error deleting user:", error);
        throw error;
    }
}

/**
 * Retrieves a cached user by their Clerk identifier.
 *
 * The cached result is tagged using the user's Clerk ID, allowing
 * selective cache invalidation after profile updates.
 *
 * @param clerkId - Clerk user identifier.
 * @returns The cached user, or `null` if no user exists.
 */
export async function getUserByClerkIdCached(clerkId: string) {
    "use cache";
    cacheTag(`user-${clerkId}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getUserByClerkId(clerkId);
}

/**
 * Retrieves the Clerk identifiers for every application user.
 *
 * Primarily used by the notification system when broadcasting
 * notifications to all users.
 *
 * @returns An array of Clerk user identifiers.
 *
 * @throws Re-throws any database errors encountered during retrieval.
 */
export async function getAllUserClerkIds() {
    try {
        const users = await prisma.user.findMany({
            select: { clerkId: true },
        });
        return users.map(user => user.clerkId);
    } catch (error) {
        console.error("Error fetching all user Clerk IDs:", error);
        throw error;
    }
}

/**
 * Resolves internal application user IDs into their corresponding
 * Clerk user identifiers.
 *
 * Invalid, empty and duplicate user IDs are automatically removed
 * before querying the database.
 *
 * This helper is primarily used by the notification system before
 * dispatching notifications through Novu.
 *
 * @param userIds - Collection of internal user IDs.
 * @returns An array of matching Clerk user identifiers.
 *
 * @throws Re-throws any database errors encountered during resolution.
 */
export async function resolveUserIdsToClerkIds(userIds: Array<string | null | undefined>): Promise<string[]> {
    try {
        const validUserIds = [...new Set(
            userIds
                .map((id) => id?.trim())
                .filter((id): id is string => Boolean(id))
        )];

        if (validUserIds.length === 0) {
            return [];
        }

        const users = await prisma.user.findMany({
            where: { id: { in: validUserIds } },
            select: { clerkId: true },
        });
        return users.map(user => user.clerkId);
    } catch (error) {
        console.error("Error resolving user IDs to Clerk IDs:", error);
        throw error;
    }
}
