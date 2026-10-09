"use client";

import { useMemo, useRef, useState } from "react";
import { Files, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/common/data-table";
import {
  dataTimeFormat,
  formatFileSize,
  formatFileType,
} from "@/utils/formatters";
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

/**
 * Formats an upload timestamp, tolerating both Date objects and the serialized
 * strings that reach the client, and never rendering "Invalid Date".
 */
function formatUploadedAt(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);

  return Number.isNaN(parsed.getTime()) ? "—" : dataTimeFormat.format(parsed);
}

export function ProjectDocumentsTab({
  project,
  isAdmin,
}: ProjectDocumentsTabProps) {
  const dispatch = useAppDispatch();
  const [fileToDelete, setFileToDelete] = useState<
    ProjectDetail["files"][number] | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const files = project.files.filter((file) => {
    if (deletedIds.has(file.id)) return false;
    const isAdminOnlyFileType =
      file.filename.toLowerCase().includes("tender")
      || file.filename.toLowerCase().includes("contract");

    return isAdmin || !isAdminOnlyFileType;
  });
  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim().toLowerCase();
  const isFiltered = trimmedQuery.length > 0;

  // The search box previously held state that nothing read, so typing in it did
  // nothing. It now filters on the two fields the user can actually see.
  const visibleFiles = useMemo(() => {
    if (!trimmedQuery) return files;

    return files.filter((file) =>
      `${file.filename} ${formatFileType(file.fileType)}`
        .toLowerCase()
        .includes(trimmedQuery),
    );
  }, [files, trimmedQuery]);

  const milestoneName = (milestoneId: string | null) => {
    if (!milestoneId) return "—";

    return (
      project.milestones.find((milestone) => milestone.id === milestoneId)?.name
      ?? "—"
    );
  };

  const handleDelete = async () => {
    if (!fileToDelete || deletingRef.current) return;
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
        `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(fileToDelete.id)}`,
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
      <CardHeader className="border-b border-border/70 pb-4">
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
                ? `${visibleFiles.length} of ${files.length} matching`
                : `${files.length} ${files.length === 1 ? "document" : "documents"}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or file type"
                className="h-9 rounded-lg pl-9 text-sm"
                aria-label="Search documents"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <DataTable
          onRowClick={(index) => {
            // Clicking a picture opens the gallery over every other image in
            // the filtered list, not just the one row — the search term the
            // user typed is what defines "the rest of the images" here.
            const action = filePreviewModal(
              // Mapped rather than passed through: `filename` is this model's
              // name field, and leaving the helper to fall back to parsing the
              // blob URL would work only for as long as the path keeps
              // embedding the name.
              visibleFiles.map((candidate) => ({
                url: candidate.url,
                name: candidate.filename,
                fileType: candidate.fileType,
              })),
              index,
            );
            if (action) dispatch(openModal(action));
          }}
          rowLabel={(index) =>
            `Open ${visibleFiles[index]?.filename ?? "document"}`
          }
          caption="Documents uploaded to this project, with size, type, linked milestone and upload time."
          headers={[
            "#",
            "Name",
            "Size",
            "Type",
            "Milestone",
            "Uploaded",
            ...(isAdmin ? ["Actions"] : []),
          ]}
          align={[
            "end",
            "start",
            "end",
            "start",
            "start",
            "start",
            ...(isAdmin ? ["end" as const] : []),
          ]}
          rows={visibleFiles.map((file, index) => [
            <span
              key={`${file.id}-number`}
              className="font-mono text-muted-foreground tabular-nums"
            >
              {index + 1}
            </span>,

            <span
              key={`${file.id}-name`}
              className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {file.filename}
            </span>,

            <span
              key={`${file.id}-size`}
              className="font-mono text-foreground tabular-nums"
            >
              {formatFileSize(file.filesize)}
            </span>,

            <span
              key={`${file.id}-type`}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
            >
              {formatFileType(file.fileType)}
            </span>,

            <span key={`${file.id}-milestone`}>
              {milestoneName(file.milestoneId)}
            </span>,

            <span key={`${file.id}-uploadedAt`} className="font-mono text-sm">
              {formatUploadedAt(file.createdAt)}
            </span>,
            ...(isAdmin
              ? [
                  <Button
                    key={`${file.id}-delete`}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isDeleting}
                    aria-label={`Delete ${file.filename}`}
                    title={`Delete ${file.filename}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteError(null);
                      setFileToDelete(file);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>,
                ]
              : []),
          ])}
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
                    ? "No documents match your search"
                    : "No documents yet"}
                </p>

                <p className="text-xs text-muted-foreground">
                  {isFiltered
                    ? `Nothing matches “${query.trim()}”. Clear the search to see all ${files.length} documents.`
                    : "Plans, quotes, permits and contracts uploaded to this project appear here."}
                </p>
              </div>

              {isFiltered ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setQuery("")}
                >
                  Clear search
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
              Delete “{fileToDelete?.filename}” from this project&apos;s
              documents and milestone photos? Copies used by other records are
              kept. This action cannot be undone.
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
