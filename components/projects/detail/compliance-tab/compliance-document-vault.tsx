"use client";

import type { ComplianceDocumentType } from "@prisma/client";
import {
  Archive,
  ChevronDown,
  ClipboardList,
  FolderOpen,
  FolderSearch,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/common/data-table";
import { ComplianceSectionCard } from "./compliance-section-card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

function VaultSectionIcon({ index }: { index: number }) {
  switch (index % 6) {
    case 0:
      return <Archive className="size-4" aria-hidden="true" />;
    case 1:
      return <Users className="size-4" aria-hidden="true" />;
    case 2:
      return <ReceiptText className="size-4" aria-hidden="true" />;
    case 3:
      return <ClipboardList className="size-4" aria-hidden="true" />;
    case 4:
      return <ShieldCheck className="size-4" aria-hidden="true" />;
    default:
      return <FolderSearch className="size-4" aria-hidden="true" />;
  }
}

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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

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
        <div className="space-y-3">
          {sections.map((section, index) => {
            const isSectionOpen = openSections[section.heading] ?? index === 0;

            return (
              <Collapsible
                key={section.heading}
                open={isSectionOpen}
                onOpenChange={(open) =>
                  setOpenSections((current) => ({
                    ...current,
                    [section.heading]: open,
                  }))
                }
                className="overflow-hidden rounded-xl border border-border/70 bg-background"
              >
                <CollapsibleTrigger className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-primary/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <VaultSectionIcon index={index} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-sm font-semibold text-foreground">
                        {section.heading}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {section.files.length} file
                        {section.files.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {section.description}
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isSectionOpen ? "rotate-180 text-primary" : ""}`}
                    aria-hidden="true"
                  />
                </CollapsibleTrigger>

                <CollapsibleContent className="overflow-hidden data-open:animate-collapsible-down data-closed:animate-collapsible-up">
                  <div className="border-t border-border/70 bg-muted/15 p-2">
                    <DataTable
                      onRowClick={(rowIndex) =>
                        openPreview(section.offset + rowIndex)
                      }
                      rowLabel={(rowIndex) =>
                        `Open ${section.files[rowIndex]?.filename ?? "document"}`
                      }
                      caption={`${section.heading} — ${section.description}`}
                      headers={["#", "Name", "Document", "Size", "Uploaded"]}
                      align={["end", "start", "start", "end", "start"]}
                      rows={section.files.map((file, rowIndex) => [
                        <span key={`index-${file.id}`} className="tabular-nums">
                          {rowIndex + 1}
                        </span>,
                        <span
                          key={`name-${file.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {file.filename}
                        </span>,
                        <span key={`type-${file.id}`}>
                          {file.documentLabel}
                        </span>,
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
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </ComplianceSectionCard>
  );
}
