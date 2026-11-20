// How one file reads in the project's Documents tab: where it came from and the
// tags it is found by. Pure and free of database imports, because the tab also
// describes a file the browser has only just uploaded, before any refetch.

import type { ComplianceDocumentType } from "@prisma/client";

import {
  PARTY_LABEL,
  complianceDocumentLabel,
  partyForDocumentType,
} from "@/constants/complianceDocuments";
import { inferFileTags, normalizeFileTags } from "../file-tags";

/** Where a document reached the project from. One per row, for the filter. */
export type ProjectDocumentSource =
  | "project"
  | "milestone"
  | "compliance"
  | "lead"
  | "incident"
  | "tradie-invoice"
  | "variation";

export const PROJECT_DOCUMENT_SOURCE_LABEL: Readonly<
  Record<ProjectDocumentSource, string>
> = {
  project: "Project upload",
  milestone: "Milestone",
  compliance: "Compliance",
  lead: "Lead",
  incident: "Incident report",
  "tradie-invoice": "Tradie invoice",
  variation: "Variation",
};

/** One row of the consolidated Documents tab. */
export type ProjectDocument = {
  /** Unique across sources: a File id, or `invoice:<id>` and the like. */
  readonly key: string;
  /** The File row behind it, when there is one. */
  readonly fileId: string | null;
  readonly name: string;
  readonly url: string;
  /** MIME type, when it is known. */
  readonly fileType: string | null;
  readonly size: number | null;
  /** ISO timestamp. */
  readonly createdAt: string;
  readonly uploadedBy: string | null;
  readonly milestoneId: string | null;
  readonly milestoneName: string | null;
  readonly source: ProjectDocumentSource;
  /** "Project › Compliance › Survey" — where it was uploaded from. */
  readonly origin: string | null;
  readonly tags: string[];
  /** Whether this tab may delete it: only a file the project owns outright. */
  readonly deletable: boolean;
  /** For a file filed on the compliance file: what it was filed as. */
  readonly complianceDocumentType?: ComplianceDocumentType | null;
};

/** The File columns describing one needs. */
export type DescribableFile = {
  readonly id: string;
  readonly filename: string;
  readonly fileType: string;
  readonly filesize: number;
  readonly url: string;
  readonly createdAt: Date | string;
  readonly projectId: string | null;
  readonly milestoneId: string | null;
  readonly leadId: number | null;
  readonly incidentId: string | null;
  readonly complianceDocumentId: string | null;
  readonly tags?: readonly string[] | null;
  readonly origin?: string | null;
};

export type DescribeFileContext = {
  readonly projectId: string;
  readonly milestoneName?: string | null;
  readonly uploadedBy?: string | null;
  readonly compliance?: {
    readonly documentType: ComplianceDocumentType;
    readonly label: string | null;
  } | null;
  readonly incidentTradieName?: string | null;
};

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

/** One File row, as the Documents tab lists it. */
export function describeProjectFile(
  file: DescribableFile,
  context: DescribeFileContext,
): ProjectDocument {
  const derived: (string | null | undefined)[] = [];
  let source: ProjectDocumentSource;

  if (file.complianceDocumentId) {
    source = "compliance";
    derived.push("Compliance");
    if (context.compliance) {
      const { documentType, label } = context.compliance;
      derived.push(complianceDocumentLabel(documentType, label));
      const party = partyForDocumentType(documentType);
      if (party) derived.push(PARTY_LABEL[party]);
    }
  } else if (file.incidentId) {
    source = "incident";
    derived.push("Incident report", context.incidentTradieName);
  } else if (file.milestoneId) {
    source = "milestone";
  } else if (file.projectId === context.projectId) {
    source = file.leadId !== null ? "lead" : "project";
  } else {
    source = "lead";
  }

  if (file.milestoneId) derived.push("Milestone", context.milestoneName);
  if (file.leadId !== null) derived.push("From lead");

  return {
    key: file.id,
    fileId: file.id,
    name: file.filename,
    url: file.url,
    fileType: file.fileType || null,
    size: file.filesize > 0 ? file.filesize : null,
    createdAt: iso(file.createdAt),
    uploadedBy: context.uploadedBy ?? null,
    milestoneId: file.milestoneId,
    milestoneName: context.milestoneName ?? null,
    source,
    origin: file.origin ?? null,
    // What the screen said first, then what the record says, then the name.
    tags: normalizeFileTags(
      file.tags,
      derived,
      inferFileTags(file.filename, file.fileType),
    ),
    deletable:
      file.projectId === context.projectId
      && !file.complianceDocumentId
      && !file.incidentId,
    complianceDocumentType: context.compliance?.documentType ?? null,
  };
}

/**
 * Collapse rows that point at the same stored object. A checklist line holds a
 * copy of the File it answers, and a recorded invoice keeps the inbox's
 * attachment: one document, listed once, found by every tag any copy carries.
 * Deletable only when every copy is.
 */
export function mergeDocumentsByUrl(
  documents: readonly ProjectDocument[],
): ProjectDocument[] {
  const byUrl = new Map<string, ProjectDocument>();
  for (const document of documents) {
    const existing = byUrl.get(document.url);
    if (!existing) {
      byUrl.set(document.url, document);
      continue;
    }
    byUrl.set(document.url, {
      ...existing,
      tags: normalizeFileTags(existing.tags, document.tags),
      origin: existing.origin ?? document.origin,
      milestoneId: existing.milestoneId ?? document.milestoneId,
      milestoneName: existing.milestoneName ?? document.milestoneName,
      deletable: false,
    });
  }
  return [...byUrl.values()];
}
