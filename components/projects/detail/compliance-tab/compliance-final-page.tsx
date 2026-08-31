"use client";

import { CheckCircle2, FileText } from "lucide-react";
import { useMemo } from "react";

import {
  COMPLIANCE_DOCUMENT_SECTIONS,
  complianceDocumentLabel,
} from "@/constants/complianceDocuments";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import { dataTimeFormat } from "@/utils/formatters";

/**
 * The completed compliance file.
 *
 * Shown once every document is approved and the section is frozen. Read-only by
 * construction: there is no control on this page, because the point of it is
 * that nothing here can change any more.
 */
export function ComplianceFinalPage({
  documents,
}: {
  documents: ComplianceDocumentWithFiles[];
}) {
  const dispatch = useAppDispatch();

  // The gallery pool spans the whole finished file, not one division: someone
  // reviewing the completed job wants to page through every photo in it.
  const previewFiles = useMemo(
    () =>
      documents.flatMap((document) =>
        document.files.map((file) => ({
          id: file.id,
          url: file.url,
          name: file.filename,
          fileType: file.fileType,
        })),
      ),
    [documents],
  );

  const handlePreviewFile = (fileId: string) => {
    const index = previewFiles.findIndex((file) => file.id === fileId);
    const action = filePreviewModal(previewFiles, index);
    if (action) dispatch(openModal(action));
  };

  const byDivision = useMemo(
    () =>
      COMPLIANCE_DOCUMENT_SECTIONS.map((division) => ({
        ...division,
        documents: documents.filter(
          (document) =>
            division.types.includes(document.documentType) &&
            document.files.length > 0,
        ),
      })).filter((division) => division.documents.length > 0),
    [documents],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-success/40 bg-success-light px-4 py-3">
        <CheckCircle2
          className="mt-0.5 size-5 shrink-0 text-success-ink"
          aria-hidden="true"
        />
        <div>
          <p className="font-medium text-foreground">
            Compliance and certification complete
          </p>
          <p className="mt-0.5 text-sm text-success-ink">
            The certifier has approved every item on their checklist. This
            file is now read-only.
          </p>
        </div>
      </div>

      {byDivision.map((division) => (
        <section
          key={division.heading}
          aria-labelledby={`division-${division.heading}`}
          className="space-y-2"
        >
          <div>
            <h3
              id={`division-${division.heading}`}
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {division.heading}
            </h3>
            <p className="text-xs text-muted-foreground/80">
              {division.description}
            </p>
          </div>

          <ul className="rounded-lg border border-border/70 bg-background px-4">
            {division.documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-border/70 py-3 last:border-b-0"
              >
                <FileText
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {complianceDocumentLabel(
                      document.documentType,
                      document.label,
                    )}
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {document.files.map((file) => (
                      <li key={file.id} className="text-sm">
                        <button
                          type="button"
                          onClick={() => handlePreviewFile(file.id)}
                          className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {file.filename}
                        </button>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {dataTimeFormat.format(new Date(file.createdAt))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
