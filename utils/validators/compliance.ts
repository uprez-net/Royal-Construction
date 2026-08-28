import { ComplianceDocumentType } from "@prisma/client";
import { z } from "zod";

import { idSchema, normalizedStringSchema } from "./common";
import { projectParamSchema } from "./projects";

// ============================================================================
// Route Parameters
// ============================================================================

/**
 * Project + compliance document route params, following the
 * `projectParamSchema.extend(...)` idiom the milestone and variation routes use.
 */
export const complianceDocumentParamSchema = projectParamSchema.extend({
  documentId: z.string().trim().min(1, "Document ID is required"),
});

export type ComplianceDocumentParam = z.infer<
  typeof complianceDocumentParamSchema
>;

// ============================================================================
// Engagement
// ============================================================================

/**
 * Starting an engagement. `subjectAddress` becomes the human-readable half of
 * every subject line on the thread, so it is captured once here rather than
 * being re-derived from the project on each send — the project can be renamed,
 * and a renamed project must not break subject correlation on a live thread.
 */
export const startEngagementSchema = z.object({
  subjectAddress: z.string().trim().min(1, "A site address is required"),
  certifierName: normalizedStringSchema.optional(),
  certifierEmail: z.email().trim().toLowerCase(),
  certifierPhone: normalizedStringSchema.optional(),
});

export type StartEngagementInput = z.infer<typeof startEngagementSchema>;

// ============================================================================
// Documents
// ============================================================================

/**
 * Attaching an already-uploaded blob to a compliance document.
 *
 * Only the id crosses the wire. The client uploads straight to Vercel Blob and
 * `/api/upload` writes the File row, so a url or a size supplied here would be
 * a second, untrusted account of a record that already exists.
 */
export const complianceDocumentUploadSchema = z
  .object({
    fileId: idSchema,
    /** A seeded required document, or an extracted checklist item. */
    documentId: idSchema.optional(),
    /**
     * The signed copies and home insurance have no row until one is uploaded,
     * so those uploads name a type instead of an id.
     */
    documentType: z.enum(ComplianceDocumentType).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.documentId && !data.documentType) {
      ctx.addIssue({
        code: "custom",
        path: ["documentId"],
        message: "Either a documentId or a documentType is required.",
      });
    }
  });

export type ComplianceDocumentUploadInput = z.infer<
  typeof complianceDocumentUploadSchema
>;

/**
 * The discovery probe, one document at a time.
 */
export const complianceDiscoverySchema = z.object({
  documentType: z.enum(ComplianceDocumentType),
});

/**
 * Labelling a received document the classifier left as UNKNOWN. Narrowed at the
 * data layer to the four types a certifier actually sends.
 */
export const classifyReceivedDocumentSchema = z.object({
  documentType: z.enum(ComplianceDocumentType),
});

export type ClassifyReceivedDocumentInput = z.infer<
  typeof classifyReceivedDocumentSchema
>;

export type ComplianceDiscoveryInput = z.infer<
  typeof complianceDiscoverySchema
>;

/**
 * Approve or reject one document.
 *
 * A rejection without a reason is rejected here rather than at the UI: the
 * reason is the only thing that tells whoever re-uploads what was wrong with
 * the first attempt, and the loop is unusable without it.
 */
export const resolveComplianceDocumentSchema = z
  .object({
    documentId: idSchema,
    decision: z.enum(["approved", "rejected"]),
    rejectionReason: normalizedStringSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "rejected" && !data.rejectionReason) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A reason is required when rejecting a document.",
      });
    }
  });

export type ResolveComplianceDocumentInput = z.infer<
  typeof resolveComplianceDocumentSchema
>;

// ============================================================================
// Email
// ============================================================================

/**
 * One attachment on an outbound reply, as the composer knows it: a blob that
 * has already been uploaded.
 */
export const certifierReplyAttachmentSchema = z.object({
  fileId: idSchema,
  name: z.string().trim().min(1),
  url: z.url(),
});

export type CertifierReplyAttachment = z.infer<
  typeof certifierReplyAttachmentSchema
>;

export const certifierReplySchema = z.object({
  body: z.string().trim().min(1, "A message is required"),
  attachments: z.array(certifierReplyAttachmentSchema).default([]),
});

export type CertifierReplyInput = z.infer<typeof certifierReplySchema>;

// ============================================================================
// Checklist extraction
// ============================================================================

/**
 * The checklist workflow trigger. `documentId` names the received CHECKLIST
 * document to read; the workflow re-reads its file itself rather than trusting
 * a url from the client.
 */
export const checklistExtractionRequestSchema = z.object({
  projectId: idSchema,
  engagementId: idSchema,
  documentId: idSchema,
});

export type ChecklistExtractionRequest = z.infer<
  typeof checklistExtractionRequestSchema
>;

// ============================================================================
// Home insurance
// ============================================================================

/**
 * The home-insurance step. "No" is a recorded answer, not an absence — it is
 * what sends the admin to icare, and the engagement should show that the
 * question was asked and answered rather than skipped.
 */
export const homeInsuranceSchema = z
  .object({
    raised: z.boolean(),
    fileId: idSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.raised && !data.fileId) {
      ctx.addIssue({
        code: "custom",
        path: ["fileId"],
        message: "Upload the certificate of insurance to record it as raised.",
      });
    }
  });

export type HomeInsuranceInput = z.infer<typeof homeInsuranceSchema>;
