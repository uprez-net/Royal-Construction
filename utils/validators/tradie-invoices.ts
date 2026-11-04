import { z } from "zod";

// The shapes the Financials tab posts. Shape only: whether the booking is on
// the project, whether the number is already recorded and whether the GST is
// plausible are the domain's to decide (lib/domain/tradies/invoices.ts).

const id = (message: string) => z.string().trim().min(1, message);

const money = (message: string) =>
  z.coerce
    .number(message)
    .min(0, message)
    .max(10_000_000, "That amount is too large");

export const recordTradieInvoiceSchema = z.object({
  projectId: id("Project ID is required"),
  scheduleId: id("Choose the booking this invoice is for"),
  invoiceNumber: z
    .string()
    .trim()
    .min(1, "Enter the invoice number")
    .max(80, "That invoice number is too long"),
  issuedDate: z.iso.date("Enter the date on the invoice"),
  dueDate: z.iso.date().optional(),
  subTotal: money("Enter the amount ex GST"),
  totalTax: money("Enter the GST, or 0"),
  notes: z.string().trim().max(2000).optional(),
  /** The emailed invoice this records, when it was confirmed from one. */
  inboxId: z.string().trim().min(1).optional(),
  /** The tradie's own invoice, uploaded with it. */
  document: z
    .object({
      name: z.string().trim().min(1).max(255),
      url: z.url(),
    })
    .optional(),
});

export type RecordTradieInvoiceFormInput = z.input<
  typeof recordTradieInvoiceSchema
>;

export const readTradieInvoiceDocumentSchema = z.object({
  projectId: id("Project ID is required"),
  name: z.string().trim().min(1).max(255),
  url: z.url(),
  contentType: z.string().trim().min(1),
});

export const dismissEmailedInvoiceSchema = z.object({
  projectId: id("Project ID is required"),
  inboxId: id("Choose the emailed invoice"),
});

export const allocateTradieInvoiceSchema = z.object({
  projectId: id("Project ID is required"),
  invoiceId: id("Invoice ID is required"),
  scheduleId: id("Choose the booking this invoice is for"),
});

export const voidTradieInvoiceSchema = z.object({
  projectId: id("Project ID is required"),
  invoiceId: id("Invoice ID is required"),
  reason: z
    .string()
    .trim()
    .min(1, "Say why the invoice is being voided")
    .max(500),
});

export const previewInvoiceRecheckSchema = z.object({
  projectId: id("Project ID is required"),
  scheduleId: id("Choose the booking to recheck"),
});

export const sendInvoiceRecheckSchema = previewInvoiceRecheckSchema.extend({
  attemptKey: id("Missing request key; close the dialog and open it again."),
});
