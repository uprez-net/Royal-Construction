import type { InvoiceStatus, VariationKind } from "@prisma/client";

// What issuing a variation reaches outside for: Xero for the invoice, a PDF
// renderer and Blob for the document, Graph for the email. Taken as ports so
// the command decides every step and the order they land in, and a test can
// prove an invoice was not raised for a promotional variation.

/** Everything the variation document and its email print. Amounts in cents. */
export type VariationDocumentData = {
  /** "V-003". */
  readonly number: string;
  readonly kind: VariationKind;
  readonly projectName: string;
  readonly siteAddress: string;
  /** As the contract names its owners: "Jane Smith & John Smith". */
  readonly clientNames: string;
  /** The first owner's own name, for the greeting. */
  readonly greetingName: string;
  readonly activityName: string;
  readonly stageLabel: string;
  readonly reason: string;
  readonly raisedDate: Date;
  readonly previousPriceCents: number;
  readonly newPriceCents: number;
  readonly differenceCents: number;
  readonly chargeExGstCents: number;
  readonly gstCents: number;
  readonly chargeIncGstCents: number;
  readonly absorbedCents: number;
  /** Xero's number for the invoice billing it, once there is one. */
  readonly invoiceNumber: string | null;
  readonly dueDate: Date | null;
};

/** The fields mirrored off the Xero invoice. */
export type VariationInvoiceFields = {
  readonly xeroInvoiceId: string;
  readonly invoiceNumber: string | null;
  readonly status: InvoiceStatus;
  readonly totalCents: number;
  readonly taxCents: number;
  readonly amountPaidCents: number;
  readonly updatedAt: Date | null;
};

export type VariationIssuePorts = {
  /**
   * Raise the client's invoice in Xero, AUTHORISED.
   *
   * Must be safe to call again for the same `reference`: an implementation
   * looks for an invoice already carrying it before creating one, so a retry
   * after a lost response adopts the invoice instead of billing twice.
   */
  readonly raiseInvoice: (input: {
    readonly projectId: string;
    readonly variationId: string;
    readonly reference: string;
    readonly lineDescription: string;
    readonly amountExGstCents: number;
    readonly issuedDate: Date;
    readonly dueDate: Date;
  }) => Promise<VariationInvoiceFields>;
  /** Render the document to PDF and archive it; answers where it landed. */
  readonly storeDocument: (input: {
    readonly projectId: string;
    readonly variationId: string;
    readonly document: VariationDocumentData;
  }) => Promise<{ readonly url: string }>;
  /** Email the document to one recipient, PDF attached. */
  readonly sendEmail: (input: {
    readonly to: string;
    readonly subject: string;
    readonly document: VariationDocumentData;
    readonly documentUrl: string;
  }) => Promise<void>;
};
