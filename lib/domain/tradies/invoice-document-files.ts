// Which files a tradie invoice can be uploaded as, and where. A leaf with no
// imports, because the Record invoice dialog needs both in the browser and the
// rest of `invoice-document.ts` reaches the database.

export const TRADIE_INVOICE_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type TradieInvoiceDocumentType =
  (typeof TRADIE_INVOICE_DOCUMENT_TYPES)[number];

/** Where a project's tradie invoices are uploaded to. */
export function tradieInvoiceDocumentFolder(projectId: string): string {
  return `projects/${projectId}/tradie-invoices/`;
}
