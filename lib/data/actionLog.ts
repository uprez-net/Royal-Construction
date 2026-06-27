'use server';
import prisma from '@/lib/prisma';
import { ActivityLogEntry } from '@/types/activityLog';
import { Prisma } from '@prisma/client';

/**
 * Creates a new activity log entry.
 *
 * This helper records user or system actions against a project and optionally
 * a milestone, providing an audit trail for important events such as project
 * creation, milestone updates, approvals and status changes.
 *
 * If a Prisma transaction client is provided, the activity log is created as
 * part of the existing transaction; otherwise, the default Prisma client is used.
 *
 * Any errors encountered while writing the log are caught and logged without
 * interrupting the calling operation, ensuring that activity logging remains
 * non-blocking.
 *
 * @param input - The activity log entry to persist.
 * @param tx - Optional Prisma transaction client used to execute the insert
 * within an existing database transaction.
 * @returns A promise that resolves once the activity log has been written or
 * an error has been handled.
 */
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