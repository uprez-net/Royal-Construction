import { put } from "@/lib/blob";
import prisma from "@/lib/prisma";
import { getDocusignConfig } from "./config";
import { createDocusignContext } from "./client";
import { downloadCombinedDocument } from "./tender-envelope";
import {
  executedPdfPathname,
  type ExecutedDocumentPrefix,
} from "./completion-classifier";

// Fetching and filing an executed PDF, shared by the Connect webhook and the
// project handoff. No "use server": as a Server Action this would let any client
// re-file any envelope's PDF onto any document. Both callers decide first that
// the envelope is the right one.

export type ExecutedParent = {
  readonly kind: ExecutedDocumentPrefix;
  // Tender id, Contract id, or Offer id for an acceptance envelope.
  readonly id: string;
};

async function storeExecutedPdf(
  docusignId: string,
  pathname: string,
): Promise<string> {
  const context = await createDocusignContext(getDocusignConfig());
  const executed = await downloadCombinedDocument(context, docusignId);
  const blob = await put(pathname, executed, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/pdf",
  });
  return blob.url;
}

// Download the combined signed document, store it and point the parent at it.
// Throws on any failure: the webhook turns that into a 500 so DocuSign
// redelivers (issue #90), and the handoff reports it.
export async function archiveExecuted(
  parent: ExecutedParent,
  docusignId: string,
): Promise<string> {
  const url = await storeExecutedPdf(
    docusignId,
    executedPdfPathname(parent.kind, docusignId),
  );
  switch (parent.kind) {
    case "tender":
      await prisma.tender.update({
        where: { id: parent.id },
        data: { executedPdfUrl: url },
      });
      break;
    case "contract":
      await prisma.contract.update({
        where: { id: parent.id },
        data: { executedPdfUrl: url },
      });
      break;
    case "offer":
      await prisma.offer.update({
        where: { id: parent.id },
        data: { executedPdfUrl: url },
      });
      break;
  }
  return url;
}

// Keep the signed copy of an envelope the app had recalled or replaced, without
// touching its parent: it is evidence, not the executed document.
export async function archiveUnexpectedCompletion(
  kind: ExecutedDocumentPrefix,
  docusignId: string,
): Promise<string> {
  return storeExecutedPdf(
    docusignId,
    executedPdfPathname(kind, docusignId, { unexpected: true }),
  );
}
