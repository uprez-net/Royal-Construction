"use server";

import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { Role } from "@prisma/client";
import { cacheTag, cacheLife } from "next/cache";

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

export async function getUserByClerkIdCached(clerkId: string) {
    "use cache";
    cacheTag(`user-${clerkId}`);
    cacheLife(CACHE_PROFILES.MEDIUM);

    return getUserByClerkId(clerkId);
}

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
