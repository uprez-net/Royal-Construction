import { ComplianceDocumentType } from "@prisma/client";

/**
 * The documents the certifier is sent before anything else can happen.
 *
 * One ordered list, read by four places that would otherwise drift apart: the
 * discovery modal iterates it, the classifier prompt enumerates it, the
 * outreach email attaches it, and the final page groups by it. Order is the
 * order the discovery loop asks for them in — it follows how a job is actually
 * assembled, title first and the full design last.
 */
export const REQUIRED_COMPLIANCE_DOCUMENTS = [
  { type: ComplianceDocumentType.DEPOSITED_PLAN, label: "Deposited Plan" },
  {
    type: ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL,
    label: "Title Search Detail & Level",
  },
  { type: ComplianceDocumentType.SURVEY, label: "Survey" },
  {
    type: ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
    label: "Preliminary architectural plans",
  },
  {
    type: ComplianceDocumentType.PLANNING_CERTIFICATE_10_7,
    label: "Section 10.7(2) & (5) Planning Certificate",
  },
  {
    type: ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    label: "Full architectural design",
  },
] as const satisfies readonly {
  type: ComplianceDocumentType;
  label: string;
}[];

export type RequiredComplianceDocument =
  (typeof REQUIRED_COMPLIANCE_DOCUMENTS)[number];

export type RequiredComplianceDocumentType =
  RequiredComplianceDocument["type"];

/**
 * What the certifier sends back, which is the second half of the classifier's
 * job. Kept separate from the required list because the two are never confused
 * in the UI — these arrive as email attachments, those are collected up front.
 */
export const CERTIFIER_RESPONSE_DOCUMENTS = [
  { type: ComplianceDocumentType.INVOICE, label: "Invoice" },
  { type: ComplianceDocumentType.FEE_PROPOSAL, label: "Fee Proposal" },
  { type: ComplianceDocumentType.CDC_FORM, label: "CDC Application Form" },
  { type: ComplianceDocumentType.CHECKLIST, label: "Checklist" },
] as const satisfies readonly {
  type: ComplianceDocumentType;
  label: string;
}[];

/**
 * What the certifier produced, as opposed to what the builder supplied.
 *
 * These arrive as attachments on the certifier's own reply, and they are not
 * part of the review loop: the certifier is not going to approve their own
 * invoice. Excluding them is what makes "every document approved" a condition
 * that can actually be reached — counting them left the engagement permanently
 * one approval short of closing, on documents with no approve control.
 */
export const CERTIFIER_SUPPLIED_TYPES: readonly ComplianceDocumentType[] = [
  ComplianceDocumentType.INVOICE,
  ComplianceDocumentType.FEE_PROPOSAL,
  ComplianceDocumentType.CDC_FORM,
  ComplianceDocumentType.CHECKLIST,
  // An attachment the classifier could not place. It is shown so a person can
  // label it, but until they do it is not evidence of anything.
  ComplianceDocumentType.UNKNOWN,
];

/** Whether a document is part of the approve/reject loop. */
export function isReviewableDocumentType(
  documentType: ComplianceDocumentType,
): boolean {
  return !CERTIFIER_SUPPLIED_TYPES.includes(documentType);
}

/**
 * Every type the classifier is allowed to return, plus UNKNOWN. Signed copies
 * and checklist items are excluded deliberately: a signed form is identified by
 * where the admin uploaded it, not by reading it, and a checklist item is a
 * line the extraction workflow produced rather than a document to identify.
 */
export const CLASSIFIABLE_DOCUMENT_TYPES = [
  ...REQUIRED_COMPLIANCE_DOCUMENTS.map((doc) => doc.type),
  ...CERTIFIER_RESPONSE_DOCUMENTS.map((doc) => doc.type),
  ComplianceDocumentType.HOME_INSURANCE,
  ComplianceDocumentType.UNKNOWN,
] as const;

const DOCUMENT_LABELS: Partial<Record<ComplianceDocumentType, string>> = {
  ...Object.fromEntries(
    [...REQUIRED_COMPLIANCE_DOCUMENTS, ...CERTIFIER_RESPONSE_DOCUMENTS].map(
      (doc) => [doc.type, doc.label],
    ),
  ),
  [ComplianceDocumentType.SIGNED_FEE_PROPOSAL]: "Signed Fee Proposal",
  [ComplianceDocumentType.SIGNED_CDC_FORM]: "Signed CDC Application Form",
  [ComplianceDocumentType.HOME_INSURANCE]: "Home Insurance",
  [ComplianceDocumentType.CHECKLIST_ITEM]: "Checklist item",
  [ComplianceDocumentType.UNKNOWN]: "Unidentified document",
};

/**
 * The human name for a document type.
 *
 * A CHECKLIST_ITEM carries its own wording in `label` — the certifier's, not
 * ours — so callers pass it and get it back; everything else has a fixed name.
 */
export function complianceDocumentLabel(
  documentType: ComplianceDocumentType,
  label?: string | null,
): string {
  if (label && label.trim()) {
    return label.trim();
  }
  return DOCUMENT_LABELS[documentType] ?? documentType;
}

/**
 * The two signed copies that gate `Get Checklist`. Both must exist before the
 * checklist can be requested, because the certifier will not issue one against
 * an unsigned fee proposal.
 */
export const SIGNED_COPY_DOCUMENTS = [
  {
    type: ComplianceDocumentType.SIGNED_FEE_PROPOSAL,
    label: "Signed Fee Proposal",
    signs: ComplianceDocumentType.FEE_PROPOSAL,
  },
  {
    type: ComplianceDocumentType.SIGNED_CDC_FORM,
    label: "Signed CDC Application Form",
    signs: ComplianceDocumentType.CDC_FORM,
  },
] as const;

/**
 * Where an admin raises home builders compensation cover when they have not
 * already. NSW only — icare is the sole HBCF provider in this state, and every
 * project in the system is a Sydney-council build today. A second state means
 * this becomes a lookup on the project's address rather than a constant.
 */
export const HBCF_INSURANCE_URL =
  "https://www.icare.nsw.gov.au/builders-and-homeowners/home-building-compensation";
