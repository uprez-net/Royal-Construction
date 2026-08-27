import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';

/**
 * Checks whether a lead already exists by matching:
 * - sender email
 * - recipient emails
 * - contact number
 *
 * Returns true if any matching lead exists.
 *
 * Lives here rather than in the webhook route because both the route and the
 * lead-extraction workflow ask the same question — the route before spending
 * anything on a message, the workflow again against what the model extracted.
 *
 * @param fromEmail - Email address of the sender
 * @param toEmails - Recipient email addresses
 * @param contactNo - Extracted contact number
 */
export async function checkLeadPresentWithEmailPhone(
  fromEmail?: string,
  toEmails: string[] = [],
  contactNo?: string
): Promise<boolean> {
  const orConditions: Prisma.LeadWhereInput[] = [];

  const normalizedFromEmail = fromEmail?.trim().toLowerCase();
  const normalizedContactNo = contactNo?.trim();

  const normalizedToEmails = toEmails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedFromEmail) {
    orConditions.push({
      email: {
        equals: normalizedFromEmail,
        mode: "insensitive",
      },
    });
  }

  if (normalizedToEmails.length > 0) {
    orConditions.push({
      email: {
        in: normalizedToEmails,
        mode: "insensitive",
      },
    });
  }

  if (
    normalizedContactNo &&
    normalizedContactNo !== "0"
  ) {
    orConditions.push({
      phone: normalizedContactNo,
    });
  }

  // Nothing useful to search with
  if (orConditions.length === 0) {
    return false;
  }

  const existingLead = await prisma.lead.findFirst({
    where: {
      OR: orConditions,
    },
    select: {
      id: true,
    },
  });

  return Boolean(existingLead);
}
