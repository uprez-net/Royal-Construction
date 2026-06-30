'use server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAllEmailThreads, parseEmailDate } from '@/utils/email-parser';
import { generateEmailChecksum } from '@/utils/generator';
import { dataTimeFormat } from '@/utils/formatters';

interface SaveLeadEmailTrailParams {
    from: string;
    to: string;
    subject: string;
    body: string;
    sentAt: Date;
}

/**
 * Persists an email conversation for a lead by extracting and storing each
 * message in the thread as an individual record.
 *
 * The email body is parsed into its constituent messages using
 * {@link getAllEmailThreads}. Each extracted message is assigned a
 * deterministic checksum via {@link generateEmailChecksum} to prevent
 * duplicate records from being inserted. Existing records with matching
 * checksums are ignored using Prisma's `createMany` with `skipDuplicates`.
 *
 * The lead is identified by matching the sender's email address (`from`)
 * against the lead's email. If no matching lead exists, the operation
 * is aborted and an error is thrown.
 *
 * @async
 * @param params - Email details to persist.
 * @param params.from - Email address of the sender. Used to locate the
 * associated lead.
 * @param params.to - Recipient email address.
 * @param params.subject - Subject of the email.
 * @param params.body - Raw email body containing the latest message and any
 * quoted conversation history.
 * @param params.sentAt - Timestamp indicating when the email was sent.
 *
 * @returns A promise that resolves once all unique email thread entries have
 * been persisted. Returns early if no email messages can be extracted.
 *
 * @throws {Error} If no lead exists with the provided sender email.
 * @throws {Error} If an unexpected database or persistence error occurs.
 */
export async function saveLeadEmailTrail({ from, to, subject, body, sentAt }: SaveLeadEmailTrailParams) {
    try {
        const leadId = await prisma.lead.findFirst({
            where: {
                email: from,
            }
        });
        if (!leadId) {
            console.log(`  No lead found with email: ${from}. Aborting save to email trail.`);
            throw new Error(`No lead found with email: ${from}. Aborting save to email trail.`);
        }
        const threads = getAllEmailThreads(body);
        if (threads.length === 0) {
            return;
        }
        const createManyData: Prisma.LeadEmailsCreateManyInput[] = [];
        for (const thread of threads) {
            const persistedSubject = thread.subject.trim() || subject;
            const checksum = await generateEmailChecksum(persistedSubject, thread.body, thread.from, thread.to, thread.sentAt);
            createManyData.push({
                leadId: leadId.id,
                emailTo: thread.to,
                subject: persistedSubject,
                body: thread.body,
                checksum: checksum,
                sentAt: parseEmailDate(thread.sentAt) ?? new Date(sentAt),
                emailFrom: thread.from,
            });
        }

        await prisma.leadEmails.createMany({
            data: createManyData,
            skipDuplicates: true, // This will skip inserting records with duplicate checksums
        });
    }
    catch (error) {
        console.error('Error saving lead email trail:', error);
        throw error;
    }
}