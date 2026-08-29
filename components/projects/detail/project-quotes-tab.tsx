"use client";

import { useMemo, useState } from "react";
import { Files, Search } from "lucide-react";

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
import { useWebMcpTool } from "@/hooks/use-webmcp-tool";
import { webMcpJson } from "@/components/webmcp/tool-result";

/** Module-level so the registration hook's declaration hash stays stable. */
const projectFilesToolSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Filters by filename or file type. Omit to list everything.",
    },
    milestoneId: {
      type: "string",
      description: "Only files attached to this milestone.",
    },
  },
  additionalProperties: false,
} as const;

interface ProjectQuotesTabProps {
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

export function ProjectQuotesTab({ project, isAdmin }: ProjectQuotesTabProps) {
  const dispatch = useAppDispatch();
  const files = project.files.filter((file) => {
    const isAdminOnlyFileType =
      file.filename.toLowerCase().includes("tender") ||
      file.filename.toLowerCase().includes("contract");

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
      project.milestones.find((milestone) => milestone.id === milestoneId)
        ?.name ?? "—"
    );
  };

  /* ── WebMCP: the documents this tab shows ──
     Deliberately reads `files`, not `project.files`. The tender and the
     contract are hidden from a non-admin above, and a tool that read the
     unfiltered list would hand an agent the filenames and blob URLs the screen
     is withholding — the agent would then quote them back to the person who is
     not allowed to see them. */
  useWebMcpTool({
    name: "get_project_files",
    title: "List this project's documents",
    description:
      "Lists the documents on the project currently open, as filename plus a direct URL. Filter with query to match a filename or file type, or with milestoneId to get just the files attached to one milestone. Returns only the documents this user is allowed to see.",
    inputSchema: projectFilesToolSchema as unknown as Record<string, unknown>,
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const search = typeof input.query === "string"
        ? input.query.trim().toLowerCase()
        : "";
      const milestoneId = typeof input.milestoneId === "string"
        ? input.milestoneId.trim()
        : "";

      const matches = files
        .filter((file) => !milestoneId || file.milestoneId === milestoneId)
        .filter((file) =>
          !search
          || `${file.filename} ${formatFileType(file.fileType)}`
            .toLowerCase()
            .includes(search),
        );

      return webMcpJson({
        projectId: project.id,
        totalCount: matches.length,
        files: matches.map((file) => ({
          id: file.id,
          filename: file.filename,
          url: file.url,
          fileType: file.fileType,
          filesize: file.filesize,
          milestoneId: file.milestoneId,
          milestone: milestoneName(file.milestoneId),
          uploadedAt: new Date(file.createdAt).toISOString(),
        })),
      });
    },
  });

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
            const file = visibleFiles[index];
            dispatch(
              openModal({
                type: "previewFile",
                payload: { fileUrl: file.url },
              }),
            );
          }}
          caption="Documents uploaded to this project, with size, type, linked milestone and upload time."
          headers={["#", "Name", "Size", "Type", "Milestone", "Uploaded"]}
          align={["end", "start", "end", "start", "start", "start"]}
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
    </Card>
  );
}
