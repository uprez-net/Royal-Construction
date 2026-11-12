import { z } from "zod";

/**
 * The body of a checklist download (issue #420): who the document names as
 * reviewer, and their signature as a PNG data URL. Loose bounds only; the
 * domain checks the name is present and the signature is a real PNG of a
 * sensible size (`isValidSignatureDataUrl`).
 */
export const checklistExportSchema = z.object({
  reviewerName: z.string().max(120),
  signatureDataUrl: z.string().max(300_000),
});

export type ChecklistExportBody = z.infer<typeof checklistExportSchema>;
