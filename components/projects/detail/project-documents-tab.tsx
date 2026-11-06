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
import { FileTagList } from "@/components/files/file-tag-list";
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
  fileKind,
  isTimeWindow,
  isWithinWindow,
  type FileKind,
} from "@/lib/files/file-filters";
import { dataTimeFormat, formatFileSize } from "@/utils/formatters";
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
import { cn } from "@/lib/utils";

interface ProjectDocumentsTabProps {
  project: ProjectDetail;
  isAdmin: boolean;
}

/** The tab's filters, as search parameters on the project URL. */
const PARAMS = [
  "docQ",
  "docType",
  "docSource",
  "docTag",
  "docUploaded",
  "docFrom",
  "docTo",
  "docMilestone",
  "docBy",
] as const;

/** How many of the most used tags sit above the table as one-press filters. */
const QUICK_TAG_COUNT = 10;

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

function formatUploadedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dataTimeFormat.format(parsed);
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

  const kindOf = useMemo(
    () =>
      new Map(
        documents.map((document) => [
          document.key,
          fileKind(document.fileType, document.name),
        ]),
      ),
    [documents],
  );

  // Options come from the rows, with counts, so no choice leads to nothing.
  const options = useMemo(() => {
    const kinds = countValues(documents.map((d) => kindOf.get(d.key)!));
    const sources = countValues(documents.map((d) => d.source));
    const tags = countValues(documents.flatMap((d) => d.tags));
    const milestones = countValues(
      documents.flatMap((d) => (d.milestoneName ? [d.milestoneName] : [])),
    );
    const uploaders = countValues(
      documents.flatMap((d) => (d.uploadedBy ? [d.uploadedBy] : [])),
    );
    return {
      kinds: kinds.map(({ value, count }) => ({
        value,
        label: FILE_KIND_LABEL[value as FileKind] ?? value,
        count,
      })),
      sources: sources.map(({ value, count }) => ({
        value,
        label:
          PROJECT_DOCUMENT_SOURCE_LABEL[value as ProjectDocumentSource]
          ?? value,
        count,
      })),
      tags: tags.map(({ value, count }) => ({ value, label: value, count })),
      milestones: milestones.map(({ value, count }) => ({
        value,
        label: value,
        count,
      })),
      uploaders: uploaders.map(({ value, count }) => ({
        value,
        label: value,
        count,
      })),
    };
  }, [documents, kindOf]);

  const uploadedWindow = isTimeWindow(filters.docUploaded)
    ? filters.docUploaded
    : null;
  const committedQuery = filters.docQ.trim().toLowerCase();
  const activeFilterCount = [
    filters.docQ,
    filters.docType,
    filters.docSource,
    filters.docTag,
    uploadedWindow,
    filters.docMilestone,
    filters.docBy,
  ].filter(Boolean).length;
  const isFiltered = activeFilterCount > 0;

  const visibleDocuments = useMemo(
    () =>
      documents.filter((document) => {
        if (filters.docType && kindOf.get(document.key) !== filters.docType) {
          return false;
        }
        if (filters.docSource && document.source !== filters.docSource) {
          return false;
        }
        if (filters.docTag && !document.tags.includes(filters.docTag)) {
          return false;
        }
        if (
          filters.docMilestone
          && document.milestoneName !== filters.docMilestone
        ) {
          return false;
        }
        if (filters.docBy && document.uploadedBy !== filters.docBy) {
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
        if (!committedQuery) return true;
        return [
          document.name,
          document.origin ?? "",
          document.uploadedBy ?? "",
          document.milestoneName ?? "",
          PROJECT_DOCUMENT_SOURCE_LABEL[document.source],
          FILE_KIND_LABEL[kindOf.get(document.key)!],
          ...document.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(committedQuery);
      }),
    [committedQuery, documents, filters, kindOf, now, uploadedWindow],
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

  const quickTags = options.tags.slice(0, QUICK_TAG_COUNT);

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="space-y-4 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
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
                ? `${visibleDocuments.length} of ${documents.length} matching`
                : `${documents.length} ${documents.length === 1 ? "document" : "documents"} from uploads, milestones, compliance, the lead, invoices and variations`}
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, tag, origin or uploader"
              className="h-9 rounded-lg pl-9 text-sm"
              aria-label="Search documents"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <FilterSelect
            label="File type"
            allLabel="All types"
            value={filters.docType}
            onChange={(docType) => setFilters({ docType })}
            options={options.kinds}
          />
          <FilterSelect
            label="Uploaded"
            allLabel="Any time"
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
          />
          <FilterSelect
            label="Source"
            allLabel="All sources"
            value={filters.docSource}
            onChange={(docSource) => setFilters({ docSource })}
            options={options.sources}
          />
          <FilterSelect
            label="Tag"
            allLabel="All tags"
            value={filters.docTag}
            onChange={(docTag) => setFilters({ docTag })}
            options={options.tags}
          />
          <FilterSelect
            label="Milestone"
            allLabel="All milestones"
            value={filters.docMilestone}
            onChange={(docMilestone) => setFilters({ docMilestone })}
            options={options.milestones}
            disabled={options.milestones.length === 0 && !filters.docMilestone}
          />
          <FilterSelect
            label="Uploaded by"
            allLabel="Anyone"
            value={filters.docBy}
            onChange={(docBy) => setFilters({ docBy })}
            options={options.uploaders}
          />
        </div>

        {uploadedWindow === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span className="block">From</span>
              <Input
                type="date"
                value={filters.docFrom}
                max={filters.docTo || undefined}
                onChange={(event) =>
                  setFilters({ docFrom: event.target.value })
                }
                className="h-9 w-40"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span className="block">To</span>
              <Input
                type="date"
                value={filters.docTo}
                min={filters.docFrom || undefined}
                onChange={(event) => setFilters({ docTo: event.target.value })}
                className="h-9 w-40"
              />
            </label>
          </div>
        ) : null}

        {quickTags.length > 0 || isFiltered ? (
          <div className="flex flex-wrap items-center gap-2">
            {quickTags.length > 0 ? (
              <span className="text-xs font-medium text-muted-foreground">
                Popular tags
              </span>
            ) : null}
            {quickTags.map(({ value, count }) => {
              const active = filters.docTag === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilters({ docTag: active ? null : value })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/70 bg-background text-foreground hover:border-primary/40 hover:text-primary",
                  )}
                >
                  {value}
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </button>
              );
            })}
            {isFiltered ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={clearFilters}
              >
                <X data-icon="inline-start" aria-hidden="true" />
                Clear {activeFilterCount}{" "}
                {activeFilterCount === 1 ? "filter" : "filters"}
              </Button>
            ) : null}
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
              visibleDocuments.map((candidate) => ({
                url: candidate.url,
                name: candidate.name,
                fileType: candidate.fileType ?? undefined,
              })),
              index,
            );
            if (action) dispatch(openModal(action));
          }}
          rowLabel={(index) =>
            `Open ${visibleDocuments[index]?.name ?? "document"}`
          }
          caption="Every document on this project, with its tags, where it came from, its milestone, size and upload time."
          headers={[
            "Name",
            "Tags",
            "Source",
            "Milestone",
            "Size",
            "Uploaded",
            ...(isAdmin ? ["Actions"] : []),
          ]}
          align={[
            "start",
            "start",
            "start",
            "start",
            "end",
            "start",
            ...(isAdmin ? ["end" as const] : []),
          ]}
          rows={visibleDocuments.map((document) => {
            const kind = kindOf.get(document.key) ?? "other";
            const Icon = KIND_ICON[kind];
            return [
              <span
                key={`${document.key}-name`}
                className="flex min-w-0 items-start gap-2.5"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="block truncate font-medium text-primary underline-offset-4 hover:underline">
                    {document.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {document.origin ?? FILE_KIND_LABEL[kind]}
                  </span>
                </span>
              </span>,

              <FileTagList
                key={`${document.key}-tags`}
                tags={document.tags}
                activeTag={filters.docTag}
                onSelect={(docTag) => setFilters({ docTag })}
                className="max-w-72"
              />,

              <span key={`${document.key}-source`} className="text-sm">
                {PROJECT_DOCUMENT_SOURCE_LABEL[document.source]}
              </span>,

              <span key={`${document.key}-milestone`} className="text-sm">
                {document.milestoneName ?? "—"}
              </span>,

              <span
                key={`${document.key}-size`}
                className="font-mono text-sm text-foreground tabular-nums"
              >
                {document.size !== null ? formatFileSize(document.size) : "—"}
              </span>,

              <span
                key={`${document.key}-uploadedAt`}
                className="block space-y-0.5"
              >
                <span className="block font-mono text-sm whitespace-nowrap tabular-nums">
                  {formatUploadedAt(document.createdAt)}
                </span>
                {document.uploadedBy ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {document.uploadedBy}
                  </span>
                ) : null}
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
                        aria-label={`Delete ${document.name}`}
                        title={`Delete ${document.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteError(null);
                          setFileToDelete(document);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : (
                      <span
                        key={`${document.key}-delete`}
                        className="text-xs text-muted-foreground"
                        title={`Managed from ${PROJECT_DOCUMENT_SOURCE_LABEL[document.source]}`}
                      >
                        —
                      </span>
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
                  {isFiltered
                    ? "No documents match these filters"
                    : "No documents yet"}
                </p>

                <p className="text-xs text-muted-foreground">
                  {isFiltered
                    ? `Nothing matches. Clear the filters to see all ${documents.length} documents.`
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
