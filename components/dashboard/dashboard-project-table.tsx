import { useAppDispatch } from "@/lib/store/hooks";
import { ProjectWithStats } from "@/types/project";
import { DataTable } from "../common/data-table";
import Link from "next/link";
import { Badge } from "../ui/badge";
import { formatStatus } from "@/utils/formatters";
import { openModal } from "@/lib/store/slices/uiSlice";
import { Search, ToolCaseIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "../ui/card";
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

interface DashboardProjectTableProps {
  projects: ProjectWithStats[];
  pageInfo: {
    totalCount: number;
    totalPages: number;
    currentPage: number;
  };
  onPageChange: (page: number) => void;
  onSearch: (query: string) => void;
}

const statusConfig: Record<
  string,
  { bg: string; text: string; stripe: string }
> = {
  ON_TRACK: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    stripe: "bg-emerald-500",
  },
  NEEDS_ATTENTION: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    stripe: "bg-amber-500",
  },
  DELAYED: { bg: "bg-red-100", text: "text-red-700", stripe: "bg-red-500" },
  ACTIVE: { bg: "bg-blue-100", text: "text-blue-700", stripe: "bg-blue-500" },
};

export function DashboardProjectTable({
  projects,
  pageInfo,
  onPageChange,
  onSearch,
}: DashboardProjectTableProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(pageInfo.currentPage);
  const paginationItems = useMemo(() => {
    const totalPages = pageInfo.totalPages;

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
  }, [currentPage, pageInfo.totalPages]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (onSearch) {
      onSearch(query);
    }
  };

  const handlePageChange = (page: number) => {
    const newPage = Math.max(1, Math.min(pageInfo.totalPages, page));
    setCurrentPage(newPage);
    if (onPageChange) {
      onPageChange(newPage);
    }
  };

  return (
    <Card className="border-border/70 bg-white/95">
      <CardHeader className="flex items-center justify-between border-b border-border/60 pb-4">
        <h4 className="uppercase font-bold text-muted-foreground">Active Project Overview</h4>
        <div className="flex flex-1 gap-3 justify-end">
          {/* Search Box */}
          <div className="relative flex-1 md:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search projects, clients..."
              value={searchQuery}
              onChange={(e) => {
                handleSearch(e.target.value);
              }}
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder-muted-foreground focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-opacity-20"
            />
          </div>

          <Button onClick={() => router.push("/projects")}>View All</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTable
          headers={[
            "Project",
            "Client",
            "Location",
            "Budget",
            "Spent",
            "Progress",
            "Status",
          ]}
          rows={projects.map((project) => [
            <div key={`name-${project.id}`}>
              <Link
                href={`/projects/${project.id}`}
                className="font-medium text-teal-600 hover:text-teal-700 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {project.name}
              </Link>
            </div>,
            <div key={`client-${project.id}`}>{project.customer.name}</div>,
            <div key={`loc-${project.id}`}>{project.location}</div>,
            <div key={`budget-${project.id}`} className="font-mono">
              ${Math.round(Number(project.totalBudget) / 1000)}K
            </div>,
            <div key={`spent-${project.id}`} className="font-mono">
              ${Math.round(Number(project.spent) / 1000)}K
            </div>,
            <div key={`prog-${project.id}`}>
              <div className="flex items-center gap-2">
                <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-teal-500"
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
                className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${(statusConfig[project.status] ?? statusConfig.ACTIVE).bg} ${(statusConfig[project.status] ?? statusConfig.ACTIVE).text}`}
              >
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
                  payload: { project },
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

        {pageInfo.totalCount > 0 ? (
          <div className="space-y-3 pt-2">
            <div className="text-center text-xs text-muted-foreground">
              Showing {projects.length} of {pageInfo.totalCount} projects
            </div>
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
                    aria-disabled={currentPage >= pageInfo.totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
