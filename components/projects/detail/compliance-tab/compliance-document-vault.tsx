"use client";

import { FolderOpen } from "lucide-react";
import { useMemo } from "react";

import { DataTable } from "@/components/common/data-table";
import { ComplianceSectionCard } from "./compliance-section-card";
import { complianceDocumentLabel } from "@/constants/complianceDocuments";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat, formatFileSize } from "@/utils/formatters";

/**
 * Every file on the engagement, whatever stage it belongs to.
 *
 * Persistent on purpose: the flow above it is a state machine that hides
 * finished steps, and without this the documents from step two become
 * unreachable by step six. Ordered newest first, because the thing someone is
 * looking for is almost always the thing that just arrived.
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
  const files = useMemo(
    () =>
      documents
        .flatMap((document) =>
          document.files.map((file) => ({
            ...file,
            documentLabel: complianceDocumentLabel(
              document.documentType,
              document.label,
            ),
          })),
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [documents],
  );

  const rows = useMemo(
    () =>
      files.map((file, index) => [
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
        <span key={`date-${file.id}`} className="text-muted-foreground">
          {dataTimeFormat.format(new Date(file.createdAt))}
        </span>,
      ]),
    [files],
  );

  return (
    <ComplianceSectionCard
      title="Document vault"
      description="Every file on this engagement, newest first."
      icon={FolderOpen}
      badge={{
        label: `${files.length} file${files.length === 1 ? "" : "s"}`,
        tone: files.length > 0 ? "primary" : "neutral",
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <DataTable
        onRowClick={(index) => {
          // The vault is the one list that holds every file on the engagement,
          // so a picture opened from here pages through all of them.
          const action = filePreviewModal(
            files.map((candidate) => ({
              url: candidate.url,
              name: candidate.filename,
              fileType: candidate.fileType,
            })),
            index,
          );
          if (action) dispatch(openModal(action));
        }}
        rowLabel={(index) => `Open ${files[index]?.filename ?? "document"}`}
        caption="Every file collected against this project's certifier engagement, newest first."
        headers={["#", "Name", "Document", "Size", "Uploaded"]}
        align={["end", "start", "start", "end", "start"]}
        rows={rows}
        emptyState={
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
        }
      />
    </ComplianceSectionCard>
  );
}
