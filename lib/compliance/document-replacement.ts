import { ComplianceDocumentType } from "@prisma/client";
import { del } from "@vercel/blob";

import prisma from "@/lib/prisma";
import { certifierEmailAttachments } from "@/types/compliance";

/**
 * What happens to the copy a replacement pushes out.
 *
 * Two ways a document gets replaced, and they have to end the same way. An
 * admin re-uploads a row (`attachComplianceDocumentFile`), or the certifier
 * emails a second version of something they have already sent — a revised fee
 * proposal after a phone call, a corrected CDC form. The second used to land as
 * a document of its own, so the engagement grew a second row of the same type
 * and the tab, which keys on type, went on showing the superseded one.
 */

/** A file row reduced to what discarding it needs. */
type StoredFile = { id: string; url: string };

/**
 * Reclaims the storage behind files a replacement pushed out.
 *
 * Two things it deliberately does not do. It never throws: the write it
 * follows is already committed, and an unreachable blob store is not a reason
 * to fail work that succeeded. And it leaves alone any blob the mail trail
 * links at — a thread bubble points straight at the object rather than at a
 * File row, so reclaiming one that was emailed, in either direction, would turn
 * that copy of the conversation into a dead link. Those are left for the
 * storage cleanup to age out.
 */
export async function discardSupersededFiles(
  engagementId: string,
  files: StoredFile[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  try {
    const emails = await prisma.certifierEmail.findMany({
      where: { engagementId },
      select: { attachments: true },
    });
    const onThread = new Set(
      emails.flatMap((email) =>
        certifierEmailAttachments(email.attachments).map((item) => item.url),
      ),
    );

    const urls = files
      .map((file) => file.url)
      .filter((url) => !onThread.has(url));
    if (urls.length > 0) {
      await del(urls);
    }
  } catch (error) {
    console.error(
      `Could not remove ${files.length} superseded compliance file(s)`,
      error,
    );
  }
}

/**
 * Files a just-arrived attachment under its type, replacing what was there.
 *
 * Called at the one moment an inbound document stops being anonymous: the
 * classifier places it, or an admin does by hand. Both used to be a one-field
 * update, which is what left a category holding two documents — and since
 * every block on the tab reads a category by its first row, the new invoice sat
 * behind the old one where nobody would look for it.
 *
 * The row that survives is the one that was already there, not the arrival.
 * Its id is what the rest of the system points at — the extraction the
 * notification offers to run, an open tab, an audit entry — and none of that
 * should break because the certifier sent a revision. So the new file is moved
 * onto it and the arrival's now-empty row is dropped, which also collapses any
 * duplicates a category picked up before this existed.
 *
 * Returns the surviving document and the files it displaced, for the caller to
 * discard once its own write has committed. A null document means there was
 * nothing to place: another run, or another admin, got there first.
 */
export async function placeInboundDocument(params: {
  engagementId: string;
  documentId: string;
  documentType: ComplianceDocumentType;
}): Promise<{ documentId: string | null; superseded: StoredFile[] }> {
  return prisma.$transaction(async (tx) => {
    const arrival = await tx.complianceDocument.findFirst({
      where: { id: params.documentId, engagementId: params.engagementId },
    });
    if (!arrival) {
      return { documentId: null, superseded: [] };
    }

    // Everything else already filed under this type. Ordered so the oldest is
    // the one kept: it is the row the engagement has been referring to all
    // along, and the arrival is a new copy of what it holds, not a new thing.
    const existing = await tx.complianceDocument.findMany({
      where: {
        engagementId: params.engagementId,
        documentType: params.documentType,
        id: { not: arrival.id },
      },
      orderBy: { order: "asc" },
      include: { files: { select: { id: true, url: true } } },
    });

    if (existing.length === 0) {
      const document = await tx.complianceDocument.update({
        where: { id: arrival.id },
        data: { documentType: params.documentType },
      });
      return { documentId: document.id, superseded: [] };
    }

    const [survivor, ...duplicates] = existing;
    const superseded = existing.flatMap((document) => document.files);

    // The arrival's files move first, then the displaced rows go by explicit
    // id, so the file that just came in cannot be caught by its own cleanup.
    await tx.file.updateMany({
      where: { complianceDocumentId: arrival.id },
      data: { complianceDocumentId: survivor.id },
    });
    await tx.file.deleteMany({
      where: { id: { in: superseded.map((file) => file.id) } },
    });

    await tx.complianceDocument.update({
      where: { id: survivor.id },
      data: {
        documentType: params.documentType,
        // The arrival's status and filename are the current facts about this
        // category; the row's order and id are what has to survive.
        status: arrival.status,
        label: arrival.label ?? survivor.label,
        // Whatever the old copy was sent back for, this is a different file.
        rejectionReason: null,
      },
    });

    await tx.complianceDocument.deleteMany({
      where: { id: { in: [arrival.id, ...duplicates.map((doc) => doc.id)] } },
    });

    return { documentId: survivor.id, superseded };
  });
}
