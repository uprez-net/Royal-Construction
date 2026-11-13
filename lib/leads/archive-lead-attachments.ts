import { createHash } from "node:crypto";
import { put } from "@/lib/blob";

import prisma from "@/lib/prisma";
import { saveFile } from "@/lib/data/file";
import { getAllAdminUsersIds } from "@/lib/data/user";
import type {
  LeadAttachmentReport,
  LeadAttachmentSource,
} from "@/lib/graph/lead-attachments";
import { withGraphRetry } from "@/lib/graph/retry";
import { buildBlobPath } from "@/utils/formatters";

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
    console.error(
      "  Failed to resolve an uploader for lead attachments:",
      error,
    );
    return null;
  }
}

/**
 * A file id derived from the lead and the Graph attachment it came from.
 *
 * This step can run twice — that is the deal with durable retries — and a
 * random id would mean a second blob and a second row for the same file. Same
 * inputs, same id: the re-run overwrites its own object and finds its own row
 * already there.
 */
function deterministicFileId(leadId: number, attachmentId: string): string {
  const digest = createHash("sha256")
    .update(`lead:${leadId}:attachment:${attachmentId}`)
    .digest("hex");

  // Shaped as a UUID so it reads like every other File id in the table.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Stores a lead's email attachments and links them to the lead.
 *
 * Runs after the lead row exists, because `leadId` is what gives each file both
 * its blob path and its row. The bytes are pulled from the mailbox again rather
 * than carried here: the message is durable storage that already holds them,
 * and a 10 MB plan set has no business travelling through a workflow's event
 * log.
 *
 * Never throws. The lead is already saved and the welcome email still has to go
 * out, so a storage failure costs the documents and nothing else.
 *
 * Returns how many files are now on the lead, re-runs included.
 */
export async function archiveLeadAttachments(
  leadId: number,
  source: LeadAttachmentSource,
  messageId: string,
  report: LeadAttachmentReport,
): Promise<number> {
  if (report.files.length === 0) {
    return 0;
  }

  const uploadedBy = await resolveUploaderId();
  if (!uploadedBy) {
    console.error(
      `  No admin user to attribute ${report.files.length} attachment(s) to; leaving them unsaved for lead ${leadId}.`,
    );
    return 0;
  }

  let archived = 0;

  for (const file of report.files) {
    // Per file: one rejected upload should not cost the client the rest of
    // what they sent.
    try {
      const fileId = deterministicFileId(leadId, file.id);

      const existing = await prisma.file.findUnique({
        where: { id: fileId },
        select: { id: true },
      });
      if (existing) {
        archived += 1;
        continue;
      }

      const data = await withGraphRetry(`download ${file.name}`, () =>
        source.downloadMessageAttachment(messageId, file.id),
      );

      const blob = await put(
        buildBlobPath({ fileId, fileName: file.name, leadId: String(leadId) }),
        data,
        {
          access: "public",
          // The path is already unique through fileId, and a suffix here would
          // break the `leads/<id>/<fileId>-` shape the delete path checks for.
          addRandomSuffix: false,
          // A retry that got as far as uploading last time writes the same
          // object again rather than failing on it.
          allowOverwrite: true,
          contentType: file.mediaType,
        },
      );

      // A system caller, not a user-facing one: this runs as a workflow step of
      // Graph mail ingestion, with no session to authorize. The lead is the one
      // that run just wrote and the uploader is the admin resolveUploaderId
      // picked, so nothing here comes from a browser.
      await saveFile({
        userId: uploadedBy,
        leadId: String(leadId),
        fileId,
        fileUrl: blob.url,
        fileName: file.name,
        fileType: file.mediaType,
        fileSize: data.byteLength,
        tags: ["Lead enquiry", "Received by email"],
        origin: "Email › Lead enquiry",
      });

      archived += 1;
    } catch (error) {
      console.error(`  Failed to archive attachment "${file.name}":`, error);
    }
  }

  return archived;
}
