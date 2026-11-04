import { isBlobStoreUrl } from "@/lib/blob-url";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainSideEffectError, DomainValidationError } from "../errors";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import {
  TRADIE_INVOICE_DOCUMENT_TYPES,
  tradieInvoiceDocumentFolder,
  type TradieInvoiceDocumentType,
} from "./invoice-document-files";

// A tradie's invoice document, uploaded when the office records the invoice:
// kept against the invoice, and read to fill in the form.
//
// The URL arrives from the browser, and the server later fetches it and pays
// to OCR it, so it is pinned to this deployment's own Blob store and to this
// project's folder. Without that, a hand-built request could point the OCR at
// any file on the internet, or file another project's invoice against this one.

export type TradieInvoiceDocument = {
  readonly url: string;
  readonly name: string;
};

/**
 * Refuse a document that is not one this project uploaded. `storeId` is the
 * deployment's own Blob store, which the adapter reads from its token.
 */
export function assertTradieInvoiceDocument(
  document: TradieInvoiceDocument,
  input: { readonly projectId: string; readonly storeId: string | null },
): TradieInvoiceDocument {
  const name = document.name.trim();
  if (!name || name.length > 255) {
    throw new DomainValidationError(
      "The invoice document needs a file name.",
      "document",
    );
  }
  const refused = new DomainValidationError(
    "That file was not uploaded to this project. Upload the invoice again.",
    "document",
  );
  if (!isBlobStoreUrl(document.url, input.storeId)) throw refused;
  let path: string;
  try {
    path = decodeURIComponent(new URL(document.url).pathname).replace(
      /^\/+/,
      "",
    );
  } catch {
    // A malformed escape is not a file we uploaded.
    throw refused;
  }
  // The URL parser resolves a literal "..", but not an encoded one, which
  // only appears once decoded: refuse it rather than trust the prefix.
  if (
    path.split("/").some((segment) => segment === "..")
    || !path.startsWith(tradieInvoiceDocumentFolder(input.projectId))
  ) {
    throw refused;
  }
  return { name, url: document.url };
}

/** What the reader found on the invoice. Anything it could not read is null. */
export type TradieInvoiceDocumentFields = {
  readonly invoiceNumber: string | null;
  /** YYYY-MM-DD. */
  readonly issuedDate: string | null;
  readonly dueDate: string | null;
  /** Dollars ex GST. */
  readonly subTotal: number | null;
  readonly totalTax: number | null;
  readonly total: number | null;
  /** The business the invoice is from, as printed. */
  readonly supplierName: string | null;
};

export type TradieInvoiceDocumentReader = (input: {
  readonly url: string;
  readonly fileName: string;
  readonly contentType: TradieInvoiceDocumentType;
}) => Promise<TradieInvoiceDocumentFields>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function money(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

/**
 * Read an uploaded invoice to fill in the Record invoice form. Suggestions
 * only: the office reviews every field before saving, and the record command
 * applies its own rules to whatever they keep.
 */
export async function readTradieInvoiceDocument(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly document: TradieInvoiceDocument;
    readonly contentType: string;
    readonly storeId: string | null;
  },
  db: DomainDb,
  read: TradieInvoiceDocumentReader,
): Promise<TradieInvoiceDocumentFields> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);
  const document = assertTradieInvoiceDocument(input.document, input);
  const contentType = TRADIE_INVOICE_DOCUMENT_TYPES.find(
    (type) => type === input.contentType,
  );
  if (!contentType) {
    throw new DomainValidationError(
      "Upload the invoice as a PDF or a photo (JPG, PNG or WebP).",
      "document",
    );
  }

  let fields: TradieInvoiceDocumentFields;
  try {
    fields = await read({
      contentType,
      fileName: document.name,
      url: document.url,
    });
  } catch (error) {
    throw new DomainSideEffectError(
      "The invoice could not be read. It is still attached; fill in the details by hand.",
      "invoice-reader",
      true,
      { cause: error },
    );
  }

  // The model's answer is a suggestion, so anything malformed is dropped
  // rather than put in front of the office as if it were read.
  let subTotal = money(fields.subTotal);
  let totalTax = money(fields.totalTax);
  const total = money(fields.total);
  if (subTotal === null && total !== null && totalTax !== null) {
    subTotal = Math.round((total - totalTax) * 100) / 100;
  }
  if (totalTax === null && total !== null && subTotal !== null) {
    totalTax = Math.round((total - subTotal) * 100) / 100;
  }
  return {
    dueDate: fields.dueDate && YMD.test(fields.dueDate) ? fields.dueDate : null,
    invoiceNumber: fields.invoiceNumber?.trim().slice(0, 80) || null,
    issuedDate:
      fields.issuedDate && YMD.test(fields.issuedDate)
        ? fields.issuedDate
        : null,
    subTotal: subTotal !== null && subTotal >= 0 ? subTotal : null,
    supplierName: fields.supplierName?.trim().slice(0, 200) || null,
    total,
    totalTax: totalTax !== null && totalTax >= 0 ? totalTax : null,
  };
}
