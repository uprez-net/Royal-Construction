import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";

/**
 * The file a compliance upload names, provided it is this project's.
 *
 * A file is the project's when it was uploaded to the project (`projectId`),
 * or when it arrived on this project's compliance file — an attachment off a
 * certifier's or consultant's email is created with no `projectId`, only the
 * compliance document it landed on, and placing it is the same act as an
 * upload.
 *
 * Read before anything is written. The attach used to look the id up and point
 * it at the document whatever project it came from, so an id from another job
 * would have moved that job's file onto this one's compliance file.
 */
export async function requireProjectComplianceFile(
  input: { readonly projectId: string; readonly fileId: string },
  db: DomainDb,
) {
  const file = await db.file.findFirst({
    where: {
      id: input.fileId,
      OR: [
        { projectId: input.projectId },
        { complianceDocument: { engagement: { projectId: input.projectId } } },
      ],
    },
    select: { id: true, filename: true, url: true },
  });
  if (file) return file;

  const elsewhere = await db.file.findUnique({
    where: { id: input.fileId },
    select: { id: true },
  });
  if (elsewhere) {
    throw new DomainAuthorizationError("That file belongs to another project.");
  }
  throw new DomainNotFoundError(`File ${input.fileId} not found.`);
}
