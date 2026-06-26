'use server';
import prisma from '@/lib/prisma';
import { ActivityLogEntry } from '@/types/activityLog';
import { Prisma } from '@prisma/client';

export async function logAction(input: ActivityLogEntry, tx?: Prisma.TransactionClient) {
    try {
        const prismaClient = tx ?? prisma;
        await prismaClient.activityLog.create({
            data: {
                id: input.id,
                type: input.type,
                message: input.message,
                authorId: input.authorId,
                createdAt: new Date(input.timestamp),
                projectId: input.projectId,
                milestoneId: input.milestoneId ?? null,
            },
        });
    } catch (error) {
        console.error("Failed to log action:", error);
    }
}