import type { DomainDb } from "../db";
import type { BlobDeletePort } from "../ports/blob";
import { certifierEmailAttachments } from "@/types/compliance";

/** A file row reduced to what discarding it needs. */
export type StoredComplianceFile = {
  readonly id: string;
  readonly url: string;
};

export type ReclamationOutcome = {
  /** Objects actually handed to storage for removal. */
  readonly reclaimed: readonly string[];
  /** Left alone because the mail trail links straight at them. */
  readonly keptOnThread: readonly string[];
  /** Left alone because another surviving File row still points at them. */
  readonly keptShared: readonly string[];
};

/**
 * Decide which blobs behind superseded compliance documents may be reclaimed.
 *
 * Two exclusions, both deliberate, both leaving objects behind for the storage
 * cleanup to age out later — that job can look at the whole project, which is
 * the right place for a decision this one cannot make:
 *
 *   - Anything the mail trail links at. A thread bubble points straight at the
 *     object rather than at a File row, so reclaiming one that was emailed, in
 *     either direction, turns that copy of the conversation into a dead link.
 *   - Anything another surviving File row still points at. The checklist mapper
 *     can answer a line with a document the pack already holds, and the copy
 *     shares the original's url; reclaiming one side's storage would empty the
 *     other's row while leaving it looking supplied.
 *
 * The rule lived in `lib/compliance/document-replacement.ts` alongside the
 * `del` call. It is here now because it is a decision about compliance
 * evidence — four callers reach it, including two Workflow handlers — and
 * because a test can only prove the exclusions hold if the storage effect is
 * something it can hand in.
 */
export async function reclaimSupersededComplianceFiles(
  engagementId: string,
  files: readonly StoredComplianceFile[],
  db: DomainDb,
  deleteBlob: BlobDeletePort,
): Promise<ReclamationOutcome> {
  const empty: ReclamationOutcome = {
    keptOnThread: [],
    keptShared: [],
    reclaimed: [],
  };
  if (files.length === 0) return empty;

  const emails = await db.certifierEmail.findMany({
    select: { attachments: true },
    where: { engagementId },
  });
  const onThread = new Set(
    emails.flatMap((email) =>
      certifierEmailAttachments(email.attachments).map((item) => item.url),
    ),
  );

  const urls = [...new Set(files.map((file) => file.url))];
  const keptOnThread = urls.filter((url) => onThread.has(url));
  const candidates = urls.filter((url) => !onThread.has(url));
  if (candidates.length === 0) {
    return { keptOnThread, keptShared: [], reclaimed: [] };
  }

  // Read after the caller's own delete has committed, so a row this
  // replacement removed is already gone and cannot vote to keep its own blob.
  const stillReferenced = await db.file.findMany({
    select: { url: true },
    where: { url: { in: candidates } },
  });
  const shared = new Set(stillReferenced.map((file) => file.url));

  const reclaimed = candidates.filter((url) => !shared.has(url));
  if (reclaimed.length > 0) {
    await deleteBlob(reclaimed);
  }
  return {
    keptOnThread,
    keptShared: candidates.filter((url) => shared.has(url)),
    reclaimed,
  };
}
