"use client";

import type { ComplianceDocumentType } from "@prisma/client";
import { FolderOpen } from "lucide-react";
import { useMemo } from "react";

import { DataTable } from "@/components/common/data-table";
import { ComplianceSectionCard } from "./compliance-section-card";
import {
  COMPLIANCE_DOCUMENT_SECTIONS,
  complianceDocumentLabel,
  SECTIONED_DOCUMENT_TYPES,
} from "@/constants/complianceDocuments";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat, formatFileSize } from "@/utils/formatters";

/** Anything with no section of its own — in practice, unidentified arrivals. */
const UNPLACED = {
  heading: "Not yet identified",
  description: "Arrived from the certifier and still to be placed.",
};

type VaultFile = ComplianceDocumentWithFiles["files"][number] & {
  documentLabel: string;
};

type VaultSection = {
  heading: string;
  description: string;
  files: VaultFile[];
  /** Where this section's first file sits in the flattened gallery pool. */
  offset: number;
};

const newestFirst = (a: VaultFile, b: VaultFile) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * Every file on the engagement, filed under where it came from.
 *
 * Persistent on purpose: the flow above it is a state machine that hides
 * finished steps, and without this the documents from step two become
 * unreachable by step six. One flat list stopped being findable somewhere past
 * a dozen files, so it is divided the same way the finished file is — by
 * provenance, off the same shared list, so the vault and the completed pack
 * cannot end up disagreeing about where a document belongs.
 *
 * Newest first within each section, because the thing someone is looking for is
 * almost always the thing that just arrived; sections themselves stay in flow
 * order, because that is the order the reader learned them in.
 */
export function ComplianceDocumentVault({
  documents,
  open,
  onOpenChange,
}: {
  documents: ComplianceDocumentWithFiles[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dispatch = useAppDispatch();

  const { sections, gallery } = useMemo(() => {
    const collect = (match: (type: ComplianceDocumentType) => boolean) =>
      documents
        .filter((document) => match(document.documentType))
        .flatMap((document) =>
          document.files.map((file) => ({
            ...file,
            documentLabel: complianceDocumentLabel(
              document.documentType,
              document.label,
            ),
          })),
        )
        .sort(newestFirst);

    const filled = [
      ...COMPLIANCE_DOCUMENT_SECTIONS.map((section) => ({
        heading: section.heading,
        description: section.description,
        files: collect((type) => section.types.includes(type)),
      })),
      {
        ...UNPLACED,
        // By exclusion rather than by naming UNKNOWN: a type added to the
        // schema and not yet given a section still has to be reachable, and a
        // file the vault silently drops is worse than one filed oddly.
        files: collect((type) => !SECTIONED_DOCUMENT_TYPES.has(type)),
      },
    ].filter((section) => section.files.length > 0);

    let offset = 0;
    const sections: VaultSection[] = filled.map((section) => {
      const placed = { ...section, offset };
      offset += section.files.length;
      return placed;
    });

    return { sections, gallery: sections.flatMap((section) => section.files) };
  }, [documents]);

  // The pool spans the whole vault rather than one section, so a photo opened
  // under Checklist evidence pages on into the rest of the engagement.
  const openPreview = (index: number) => {
    const action = filePreviewModal(
      gallery.map((file) => ({
        url: file.url,
        name: file.filename,
        fileType: file.fileType,
      })),
      index,
    );
    if (action) dispatch(openModal(action));
  };

  return (
    <ComplianceSectionCard
      title="Document vault"
      description="Every file on this engagement, filed by where it came from."
      icon={FolderOpen}
      badge={{
        label: `${gallery.length} file${gallery.length === 1 ? "" : "s"}`,
        tone: gallery.length > 0 ? "primary" : "neutral",
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      {sections.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="rounded-lg bg-muted p-2">
            <FolderOpen
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
          <p className="text-sm font-medium text-foreground">
            No documents yet
          </p>
          <p className="text-xs text-muted-foreground">
            Everything collected or received for the certifier appears here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.heading}
                </h4>
                <span className="text-xs tabular-nums text-muted-foreground/80">
                  {section.files.length} file
                  {section.files.length === 1 ? "" : "s"}
                </span>
                <p className="w-full text-xs text-muted-foreground/80">
                  {section.description}
                </p>
              </div>

              <DataTable
                onRowClick={(index) => openPreview(section.offset + index)}
                rowLabel={(index) =>
                  `Open ${section.files[index]?.filename ?? "document"}`
                }
                caption={`${section.heading} — ${section.description}`}
                headers={["#", "Name", "Document", "Size", "Uploaded"]}
                align={["end", "start", "start", "end", "start"]}
                rows={section.files.map((file, index) => [
                  <span key={`index-${file.id}`} className="tabular-nums">
                    {index + 1}
                  </span>,
                  <span
                    key={`name-${file.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {file.filename}
                  </span>,
                  <span key={`type-${file.id}`}>{file.documentLabel}</span>,
                  <span key={`size-${file.id}`} className="tabular-nums">
                    {formatFileSize(file.filesize)}
                  </span>,
                  <span
                    key={`date-${file.id}`}
                    className="text-muted-foreground"
                  >
                    {dataTimeFormat.format(new Date(file.createdAt))}
                  </span>,
                ])}
              />
            </section>
          ))}
        </div>
      )}
    </ComplianceSectionCard>
  );
}
