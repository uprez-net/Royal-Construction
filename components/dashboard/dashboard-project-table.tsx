import { useAppDispatch } from "@/lib/store/hooks";
import { DataTable } from "../common/data-table";
import Link from "next/link";
import { Badge } from "../ui/badge";
import { formatStatus } from "@/utils/formatters";
import { openModal } from "@/lib/store/slices/uiSlice";
import { ResultStatus } from "@/components/common/result-status";
import { ToolCaseIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  TableCard,
  TOOLBAR_BUTTON_CLASS,
  ToolbarSearch,
} from "@/components/common/list-toolbar";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { useRouter } from "next/navigation";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useDebounce } from "@/hooks/use-debounce";
import type { PaginatedProjectsResult } from "@/lib/data/projects";
import { fetchJson } from "@/utils/fetch";
import { dashboardProjectsUrl } from "./dashboard-project-query";

interface DashboardProjectTableProps {
  isAdmin: boolean;
  initialProjects: PaginatedProjectsResult;
}

// The page shown with the server's first render, keyed by the URL it came from.
interface LoadedProjects {
  url: string;
  result: PaginatedProjectsResult;
}

// Status tones on the token pair (tint + ink). Red is for delayed only, and
// attention is orange: a warning, not an alarm.
const statusConfig: Record<string, { pill: string }> = {
  ON_TRACK: { pill: "bg-success-light text-success-ink" },
  NEEDS_ATTENTION: { pill: "bg-warning-light text-warning-ink" },
  DELAYED: { pill: "bg-destructive-light text-destructive-ink" },
  ACTIVE: { pill: "bg-info-light text-info-ink" },
};

export function DashboardProjectTable({
  isAdmin,
  initialProjects,
}: DashboardProjectTableProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [currentPage, setCurrentPage] = useState(initialProjects.page);
  const [loaded, setLoaded] = useState<LoadedProjects>(() => ({
    url: dashboardProjectsUrl({ page: initialProjects.page, search: "" }),
    result: initialProjects,
  }));
  // The URL whose request failed. Cleared by a new URL, so a failure never
  // stays on screen once the person has moved on.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const { items: projects, totalCount, totalPages } = loaded.result;

  // A fresh server render (router.refresh) replaces what the table shows. Set
  // during render, not in an effect, so the table never paints the old rows.
  const [seenInitial, setSeenInitial] = useState(initialProjects);
  if (seenInitial !== initialProjects) {
    setSeenInitial(initialProjects);
    setLoaded({
      url: dashboardProjectsUrl({ page: initialProjects.page, search: "" }),
      result: initialProjects,
    });
  }

  // The URL this table should show: the search box and page as they are now.
  const url = dashboardProjectsUrl({
    page: currentPage,
    search: debouncedSearch,
  });
  const loadError = failedUrl === url;
  const loading = url !== loaded.url && !loadError;

  // Fetch only when the URL differs from what is on screen. A change aborts the
  // request still in flight, so a slow earlier response can never overwrite the
  // page the person is looking at.
  useEffect(() => {
    if (url === loaded.url) return;
    const controller = new AbortController();
    void (async () => {
      try {
        setFailedUrl(null);
        const response = await fetchJson<PaginatedProjectsResult>(
          url,
          { method: "GET" },
          "Unable to load projects",
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setLoaded({ url, result: response.data });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Error fetching dashboard projects:", error);
        setFailedUrl(url);
      }
    })();
    return () => controller.abort();
  }, [url, loaded.url, retryNonce]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)));
  };

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [currentPage, totalPages]);

  return (
    <TableCard
      header={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="font-heading text-[1.0625rem] leading-[1.3] font-semibold tracking-[-0.01em] text-foreground">
              Active Project Overview
            </h2>
            <p className="text-sm text-muted-foreground">
              Jobs currently moving through delivery.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:gap-3">
            <ToolbarSearch
              aria-label="Search projects or clients"
              placeholder="Search projects, clients..."
              value={searchQuery}
              onChange={(e) => {
                handleSearch(e.target.value);
              }}
            />
            <Button
              variant="outline"
              className={TOOLBAR_BUTTON_CLASS}
              onClick={() => router.push("/projects")}
            >
              View All
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-4 md:p-0">
        <div
          aria-busy={loading}
          className={
            loading ? "opacity-60 transition-opacity" : "transition-opacity"
          }
        >
          <DataTable
            flush
            mobileLayout="cards"
            // Budget and Spent are an admin's: the payload for anyone else
            // carries zeros (`financialsHidden`), and a column of $0K would
            // read as "free", not "hidden".
            headers={[
              "Project",
              "Client",
              "Location",
              ...(isAdmin ? ["Budget", "Spent"] : []),
              "Progress",
              "Status",
            ]}
            rows={projects.map((project) => [
              <div key={`name-${project.id}`}>
                <Link
                  href={`/projects/${project.id}`}
                  className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  onClick={(event) => event.stopPropagation()}
                >
                  {project.name}
                </Link>
              </div>,
              <div key={`client-${project.id}`}>{project.customer.name}</div>,
              <div key={`loc-${project.id}`}>{project.location}</div>,
              ...(isAdmin
                ? [
                    <div key={`budget-${project.id}`} className="font-mono">
                      ${Math.round(Number(project.totalBudget) / 1000)}K
                    </div>,
                    <div key={`spent-${project.id}`} className="font-mono">
                      ${Math.round(Number(project.spent) / 1000)}K
                    </div>,
                  ]
                : []),
              <div key={`prog-${project.id}`}>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${project.progressPercent}%` }}
                    />
                  </div>
                  <span className="font-mono font-semibold">
                    {project.progressPercent}%
                  </span>
                </div>
              </div>,
              <div key={`status-${project.id}`}>
                <Badge
                  className={`h-[22px] gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ${(statusConfig[project.status] ?? statusConfig.ACTIVE).pill}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-current"
                  />
                  {formatStatus(project.status)}
                </Badge>
              </div>,
            ])}
            onRowClick={(rowIndex) => {
              const project = projects[rowIndex];
              if (project) {
                dispatch(
                  openModal({
                    type: "projectDetail",
                    payload: { project, isAdmin: isAdmin },
                  }),
                );
              }
            }}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <ToolCaseIcon className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No Project data available
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your Projects will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>

        {/* The table is flush from md up, so the footer keeps the header's inset. */}
        <div
          className={cn("md:px-4 md:pb-4", totalCount > 0 && "space-y-3 pt-2")}
        >
          {loadError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-center gap-3 text-center text-sm text-destructive"
            >
              <span>
                Couldn&apos;t load projects. The list below may be out of date.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetryNonce((nonce) => nonce + 1)}
              >
                Retry
              </Button>
            </div>
          ) : null}
          <ResultStatus
            count={totalCount}
            shown={projects.length}
            noun="project"
            hideWhenEmpty
            className="text-center text-xs text-muted-foreground"
          />
          {totalCount > 0 ? (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      handlePageChange(currentPage - 1);
                    }}
                    aria-disabled={currentPage === 1}
                  />
                </PaginationItem>
                {paginationItems.map((item, index) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        href="#"
                        isActive={item === currentPage}
                        onClick={(event) => {
                          event.preventDefault();
                          handlePageChange(item);
                        }}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      handlePageChange(currentPage + 1);
                    }}
                    aria-disabled={currentPage >= totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      </div>
    </TableCard>
  );
}
