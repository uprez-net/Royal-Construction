"use client";

import { useMemo, useRef, useState } from "react";
import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/common/data-table";
import { FilterSelect } from "@/components/common/filter-select";
import {
  useDebouncedSearchParam,
  useSearchParamFilters,
} from "@/hooks/use-search-param-filters";
import {
  PROJECT_DOCUMENT_SOURCE_LABEL,
  describeProjectFile,
  type ProjectDocument,
  type ProjectDocumentSource,
} from "@/lib/domain/projects/document-tags";
import {
  FILE_KIND_LABEL,
  TIME_WINDOWS,
  TIME_WINDOW_LABEL,
  countValues,
  displayFileName,
  fileKind,
  isTimeWindow,
  isWithinWindow,
  type FileKind,
} from "@/lib/files/file-filters";
import { dataTimeFormat, dateFormat, formatFileSize } from "@/utils/formatters";
import { ProjectDetail } from "@/types/project";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { filePreviewModal } from "@/utils/file-preview";
import { removeFileFromProject } from "@/lib/store/slices/projectsSlice";
import { fetchJson } from "@/utils/fetch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ProjectDocumentsTabProps {
  project: ProjectDetail;
  isAdmin: boolean;
}

/** The tab's filters, as search parameters on the project URL. */
const PARAMS = [
  "docQ",
  "docType",
  "docSource",
  "docUploaded",
  "docFrom",
  "docTo",
  "docMilestone",
] as const;

const KIND_ICON: Record<FileKind, typeof FileIcon> = {
  pdf: FileText,
  image: FileImage,
  word: FileText,
  spreadsheet: FileSpreadsheet,
  text: FileText,
  other: FileIcon,
};

function isAdminOnly(document: ProjectDocument) {
  const name = document.name.toLowerCase();
  return name.includes("tender") || name.includes("contract");
}

function parseDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * What the search box matches. The tags and the upload trail are in here but
 * never on screen: they are how "survey", "slab" or "certifier" finds a file
 * whose name says none of those things.
 */
function searchText(document: ProjectDocument, kind: FileKind) {
  return [
    document.name,
    document.milestoneName ?? "",
    document.uploadedBy ?? "",
    document.origin ?? "",
    PROJECT_DOCUMENT_SOURCE_LABEL[document.source],
    FILE_KIND_LABEL[kind],
    ...document.tags,
  ]
    .join(" ")
    .toLowerCase();
}

export function ProjectDocumentsTab({
  project,
  isAdmin,
}: ProjectDocumentsTabProps) {
  const dispatch = useAppDispatch();
  const [fileToDelete, setFileToDelete] = useState<ProjectDocument | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  // One "now" per visit, so the time filter does not shift while it is read.
  const [now] = useState(() => new Date());

  const [filters, setFilters] = useSearchParamFilters(PARAMS);
  const [query, setQuery] = useDebouncedSearchParam(filters.docQ, (docQ) =>
    setFilters({ docQ }),
  );

  // The server's consolidated list, plus anything uploaded from the header
  // since it was read — those are in `files` until the next refresh.
  const documents = useMemo(() => {
    const known = new Set(
      project.documents.flatMap((document) =>
        document.fileId ? [document.fileId] : [],
      ),
    );
    const milestoneNames = new Map(
      project.milestones.map((milestone) => [milestone.id, milestone.name]),
    );
    const fresh = project.files
      .filter((file) => !known.has(file.id))
      .map((file) =>
        describeProjectFile(file, {
          projectId: project.id,
          milestoneName: file.milestoneId
            ? milestoneNames.get(file.milestoneId)
            : null,
        }),
      );
    return [...fresh, ...project.documents].filter(
      (document) =>
        !(document.fileId && deletedIds.has(document.fileId))
        && (isAdmin || !isAdminOnly(document)),
    );
  }, [
    deletedIds,
    isAdmin,
    project.documents,
    project.files,
    project.id,
    project.milestones,
  ]);

  const indexed = useMemo(
    () =>
      documents.map((document) => {
        const kind = fileKind(document.fileType, document.name);
        return { document, kind, haystack: searchText(document, kind) };
      }),
    [documents],
  );

  // Options come from the rows, with counts, so no choice leads to nothing.
  const options = useMemo(
    () => ({
      kinds: countValues(indexed.map((row) => row.kind)).map(
        ({ value, count }) => ({
          value,
          label: FILE_KIND_LABEL[value as FileKind] ?? value,
          count,
        }),
      ),
      sources: countValues(indexed.map((row) => row.document.source)).map(
        ({ value, count }) => ({
          value,
          label:
            PROJECT_DOCUMENT_SOURCE_LABEL[value as ProjectDocumentSource]
            ?? value,
          count,
        }),
      ),
      milestones: countValues(
        indexed.flatMap((row) =>
          row.document.milestoneName ? [row.document.milestoneName] : [],
        ),
      ).map(({ value, count }) => ({ value, label: value, count })),
    }),
    [indexed],
  );

  const uploadedWindow = isTimeWindow(filters.docUploaded)
    ? filters.docUploaded
    : null;
  const committedQuery = filters.docQ.trim().toLowerCase();
  const isFiltered = [
    filters.docQ,
    filters.docType,
    filters.docSource,
    uploadedWindow,
    filters.docMilestone,
  ].some(Boolean);

  const visible = useMemo(
    () =>
      indexed.filter(({ document, kind, haystack }) => {
        if (filters.docType && kind !== filters.docType) return false;
        if (filters.docSource && document.source !== filters.docSource) {
          return false;
        }
        if (
          filters.docMilestone
          && document.milestoneName !== filters.docMilestone
        ) {
          return false;
        }
        if (
          !isWithinWindow(document.createdAt, uploadedWindow, now, {
            from: filters.docFrom,
            to: filters.docTo,
          })
        ) {
          return false;
        }
        // Every word must match somewhere, so "slab photo" narrows rather
        // than needing the words side by side.
        return committedQuery
          .split(/\s+/)
          .every((word) => haystack.includes(word));
      }),
    [committedQuery, filters, indexed, now, uploadedWindow],
  );

  const clearFilters = () => {
    setQuery("");
    setFilters(
      Object.fromEntries(PARAMS.map((key) => [key, null])) as Record<
        (typeof PARAMS)[number],
        null
      >,
    );
  };

  const handleDelete = async () => {
    if (!fileToDelete?.fileId || deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { data } = await fetchJson<{
        projectId: string;
        fileId: string;
        url: string;
        storageCleanupFailed: boolean;
      }>(
        `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(fileToDelete.fileId)}`,
        { method: "DELETE" },
        "Unable to delete the document. Please try again.",
      );
      dispatch(removeFileFromProject(data));
      setDeletedIds((current) => new Set(current).add(data.fileId));
      setFileToDelete(null);
      if (data.storageCleanupFailed) {
        toast.warning(
          "Document removed. Its stored file could not be cleaned up.",
        );
      } else {
        toast.success("Document deleted");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to delete the document.";
      setDeleteError(message);
      toast.error(message);
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="space-y-3 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Project documents
          </CardTitle>
          <p
            className="text-sm text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {isFiltered
              ? `${visible.length} of ${documents.length}`
              : `${documents.length} ${documents.length === 1 ? "document" : "documents"}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              className="h-9 rounded-lg pl-9 text-sm"
              aria-label="Search documents"
            />
          </div>
          <FilterSelect
            hideLabel
            label="File type"
            allLabel="All types"
            value={filters.docType}
            onChange={(docType) => setFilters({ docType })}
            options={options.kinds}
            className="w-[calc(50%-0.25rem)] sm:w-36"
          />
          <FilterSelect
            hideLabel
            label="Uploaded"
            allLabel="Any date"
            value={uploadedWindow ?? ""}
            onChange={(docUploaded) =>
              setFilters(
                docUploaded === "custom"
                  ? { docUploaded }
                  : { docUploaded, docFrom: null, docTo: null },
              )
            }
            options={TIME_WINDOWS.map((window) => ({
              value: window,
              label: TIME_WINDOW_LABEL[window],
            }))}
            className="w-[calc(50%-0.25rem)] sm:w-40"
          />
          <FilterSelect
            hideLabel
            label="Source"
            allLabel="All sources"
            value={filters.docSource}
            onChange={(docSource) => setFilters({ docSource })}
            options={options.sources}
            className="w-[calc(50%-0.25rem)] sm:w-40"
          />
          {options.milestones.length > 0 || filters.docMilestone ? (
            <FilterSelect
              hideLabel
              label="Milestone"
              allLabel="All milestones"
              value={filters.docMilestone}
              onChange={(docMilestone) => setFilters({ docMilestone })}
              options={options.milestones}
              className="w-[calc(50%-0.25rem)] sm:w-44"
            />
          ) : null}
          {isFiltered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={clearFilters}
            >
              <X data-icon="inline-start" aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </div>

        {uploadedWindow === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              From
              <Input
                type="date"
                value={filters.docFrom}
                max={filters.docTo || undefined}
                onChange={(event) =>
                  setFilters({ docFrom: event.target.value })
                }
                className="h-8 w-40"
              />
            </label>
            <label className="flex items-center gap-2">
              to
              <Input
                type="date"
                value={filters.docTo}
                min={filters.docFrom || undefined}
                onChange={(event) => setFilters({ docTo: event.target.value })}
                className="h-8 w-40"
              />
            </label>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-4">
        <DataTable
          mobileLayout="cards"
          mobileTitleColumn={0}
          onRowClick={(index) => {
            // The gallery covers every image in the filtered list, so the
            // filters define "the rest of the images" here.
            const action = filePreviewModal(
              visible.map(({ document }) => ({
                url: document.url,
                name: document.name,
                fileType: document.fileType ?? undefined,
              })),
              index,
            );
            if (action) dispatch(openModal(action));
          }}
          rowLabel={(index) =>
            `Open ${visible[index]?.document.name ?? "document"}`
          }
          caption="Every document on this project, with where it came from, when it was uploaded and its size."
          headers={[
            "Name",
            "Source",
            "Uploaded",
            "Size",
            ...(isAdmin ? [""] : []),
          ]}
          align={[
            "start",
            "start",
            "start",
            "end",
            ...(isAdmin ? ["end" as const] : []),
          ]}
          rows={visible.map(({ document, kind }) => {
            const Icon = KIND_ICON[kind];
            const uploadedAt = parseDate(document.createdAt);
            return [
              <span
                key={`${document.key}-name`}
                className="flex min-w-0 items-center gap-2.5"
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="max-w-[min(32rem,55vw)] min-w-0">
                  <span
                    className="block truncate font-medium text-primary underline-offset-4 hover:underline"
                    title={document.name}
                  >
                    {displayFileName(document.name)}
                  </span>
                  {document.milestoneName ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {document.milestoneName}
                    </span>
                  ) : null}
                </span>
              </span>,

              <span
                key={`${document.key}-source`}
                className="text-sm text-muted-foreground"
              >
                {PROJECT_DOCUMENT_SOURCE_LABEL[document.source]}
              </span>,

              <span
                key={`${document.key}-uploadedAt`}
                className="text-sm whitespace-nowrap tabular-nums"
                title={
                  uploadedAt
                    ? `${dataTimeFormat.format(uploadedAt)}${document.uploadedBy ? ` · ${document.uploadedBy}` : ""}`
                    : undefined
                }
              >
                {uploadedAt ? dateFormat.format(uploadedAt) : "—"}
              </span>,

              <span
                key={`${document.key}-size`}
                className="text-sm text-muted-foreground tabular-nums"
              >
                {document.size !== null ? formatFileSize(document.size) : "—"}
              </span>,
              ...(isAdmin
                ? [
                    document.deletable && document.fileId ? (
                      <Button
                        key={`${document.key}-delete`}
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={isDeleting}
                        aria-label={`Delete ${displayFileName(document.name)}`}
                        title={`Delete ${displayFileName(document.name)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteError(null);
                          setFileToDelete(document);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : (
                      <span key={`${document.key}-delete`} />
                    ),
                  ]
                : []),
            ];
          })}
          emptyState={
            <div className="mx-auto flex max-w-md flex-col items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                <Files
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {isFiltered ? "No documents match" : "No documents yet"}
                </p>

                <p className="text-xs text-muted-foreground">
                  {isFiltered
                    ? `Clear the search and filters to see all ${documents.length} documents.`
                    : "Plans, quotes, permits, compliance documents and invoices for this project appear here."}
                </p>
              </div>

              {isFiltered ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          }
        />
      </CardContent>
      <AlertDialog
        open={fileToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingRef.current) {
            setFileToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{fileToDelete?.name}” from this project&apos;s documents
              and milestone photos? Copies used by other records are kept. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              aria-busy={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {isDeleting ? "Deleting…" : "Delete document"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
