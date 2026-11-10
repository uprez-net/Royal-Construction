import {
  CertifierEmailDirection,
  ComplianceDocumentType,
  type Prisma,
} from "@prisma/client";

import type { TransactionalDomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { BlobDeletePort } from "../ports/blob";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { reclaimSupersededComplianceFiles } from "./file-reclamation";

export type DismissComplianceArrivalOutcome = {
  readonly documentId: string;
  readonly engagementId: string;
  readonly fileNames: readonly string[];
  /** Objects actually removed from storage. */
  readonly reclaimed: number;
  /**
   * Set when the rows went but storage could not be reached. Nothing is lost
   * by it — the objects are unreferenced and the cleanup can take them — but
   * the adapter should log it rather than let it pass silently.
   */
  readonly reclaimError: unknown;
};

function withoutUrls(value: Prisma.JsonValue, urls: ReadonlySet<string>) {
  if (!Array.isArray(value)) return null;
  const kept = value.filter(
    (item) =>
      !(
        item
        && typeof item === "object"
        && !Array.isArray(item)
        && typeof item.url === "string"
        && urls.has(item.url)
      ),
  );
  return kept.length === value.length ? null : kept;
}

/**
 * Throw away an attachment nobody could identify, because it is not part of
 * the job: a signature logo, a social icon, a forwarded flyer.
 *
 * Only an UNKNOWN row can be dismissed. Everything else on the file is a
 * document the engagement relies on, and the way to replace one is to upload
 * over it, not to delete it from here.
 *
 * Deleting the row alone would free nothing. The storage reclamation keeps any
 * object the mail trail links at, and an arrival is by definition linked from
 * the inbound message it came on. So the link is taken off that message too —
 * inbound messages only: if somebody forwarded the file on, the outbound copy
 * keeps its link and the object stays for it.
 */
export async function dismissUnidentifiedComplianceDocument(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly documentId: string },
  db: TransactionalDomainDb,
  ports: { readonly deleteBlob: BlobDeletePort },
): Promise<DismissComplianceArrivalOutcome> {
  requireAdminPrincipal(principal);

  const removed = await db.$transaction(async (tx) => {
    const document = await tx.complianceDocument.findFirst({
      where: {
        id: input.documentId,
        documentType: ComplianceDocumentType.UNKNOWN,
        engagement: { projectId: input.projectId },
      },
      select: {
        id: true,
        engagementId: true,
        files: { select: { id: true, url: true, filename: true } },
      },
    });
    if (!document) {
      throw new DomainNotFoundError(
        "That file has already been identified or dismissed.",
      );
    }

    const urls = new Set(document.files.map((file) => file.url));
    if (urls.size > 0) {
      const emails = await tx.certifierEmail.findMany({
        where: {
          engagementId: document.engagementId,
          direction: CertifierEmailDirection.INBOUND,
        },
        select: { id: true, attachments: true },
      });
      for (const email of emails) {
        const kept = withoutUrls(email.attachments, urls);
        if (kept) {
          await tx.certifierEmail.update({
            where: { id: email.id },
            data: { attachments: kept as Prisma.InputJsonValue },
          });
        }
      }
    }

    await tx.file.deleteMany({ where: { complianceDocumentId: document.id } });
    await tx.complianceDocument.delete({ where: { id: document.id } });
    return document;
  });

  // After the commit, so a rolled-back dismissal can never have emptied a
  // file that is still on the row. The reclamation re-checks the thread and
  // any other row sharing the object, so this cannot reach a live file.
  let reclaimed = 0;
  let reclaimError: unknown = null;
  try {
    const outcome = await reclaimSupersededComplianceFiles(
      removed.engagementId,
      removed.files,
      db,
      ports.deleteBlob,
    );
    reclaimed = outcome.reclaimed.length;
  } catch (error) {
    reclaimError = error;
  }

  return {
    documentId: removed.id,
    engagementId: removed.engagementId,
    fileNames: removed.files.map((file) => file.filename),
    reclaimed,
    reclaimError,
  };
}
