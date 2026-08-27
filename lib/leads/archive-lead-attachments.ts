import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';

import { saveFile } from '@/lib/data/file';
import { getAllAdminUsersIds } from '@/lib/data/user';
import type { DownloadedAttachment } from '@/lib/graph/lead-attachments';
import { buildBlobPath } from '@/utils/formatters';

/**
 * `File.uploadedBy` is a required relation, but nobody uploaded these — they
 * arrived on an email. An admin is the closest real actor the schema allows,
 * and it keeps the document visible to the people who work the lead. If the
 * instance has no admin at all there is no valid row to write, so nothing is
 * uploaded either rather than leaving blobs with no record pointing at them.
 */
async function resolveUploaderId(): Promise<string | null> {
  try {
    const [adminId] = await getAllAdminUsersIds();
    return adminId ?? null;
  } catch (error) {
    console.error('  Failed to resolve an uploader for lead attachments:', error);
    return null;
  }
}

/**
 * Stores a lead's email attachments and links them to the lead.
 *
 * Runs after the lead row exists, because `leadId` is what gives each file both
 * its blob path and its row. Never throws: the lead is already saved and the
 * welcome email still has to go out, so a storage failure costs the documents,
 * not the lead.
 *
 * Returns how many files were archived.
 */
export async function archiveLeadAttachments(
  leadId: number,
  attachments: DownloadedAttachment[],
): Promise<number> {
  if (attachments.length === 0) {
    return 0;
  }

  const uploadedBy = await resolveUploaderId();
  if (!uploadedBy) {
    console.error(
      `  No admin user to attribute ${attachments.length} attachment(s) to; leaving them unsaved for lead ${leadId}.`,
    );
    return 0;
  }

  let archived = 0;

  for (const attachment of attachments) {
    // Per file: one rejected upload should not cost the client the rest of
    // what they sent.
    try {
      // The row id is minted here rather than by the database, because the blob
      // path embeds it — it is what ties the stored object to its record, and
      // what `deleteLeadBlob` walks back when a document is removed.
      const fileId = randomUUID();

      const blob = await put(
        buildBlobPath({ fileId, fileName: attachment.name, leadId: String(leadId) }),
        attachment.data,
        {
          access: 'public',
          // The path is already unique through fileId, and a suffix here would
          // break the `leads/<id>/<fileId>-` shape the delete path checks for.
          addRandomSuffix: false,
          contentType: attachment.mediaType,
        },
      );

      await saveFile({
        userId: uploadedBy,
        leadId: String(leadId),
        fileId,
        fileUrl: blob.url,
        fileName: attachment.name,
        fileType: attachment.mediaType,
        fileSize: attachment.data.byteLength,
      });

      archived += 1;
    } catch (error) {
      console.error(`  Failed to archive attachment "${attachment.name}":`, error);
    }
  }

  return archived;
}
