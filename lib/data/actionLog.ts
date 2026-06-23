'use server';
import prisma from '@/lib/prisma';
import { ActivityLogEntry } from '@/types/activityLog';

export async function logAction(input: ActivityLogEntry) {
    try {
        await prisma.activityLog.create({
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