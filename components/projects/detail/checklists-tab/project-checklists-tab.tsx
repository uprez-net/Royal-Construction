"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Download,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChecklistSummary } from "@/lib/domain/projects/checklists";
import { CHECKLIST_STATUS_LABELS } from "@/lib/domain/projects/checklist-rules";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/project";

import { ChecklistInspection } from "./checklist-inspection";
import { DownloadChecklistDialog } from "./checklist-dialogs";
import {
  DISPLAY_TONE,
  formatDateTime,
  useProjectChecklists,
} from "./checklist-client";

// The Checklists tab (issue #420): the project's six stage checklists, and
// the inspection screen for whichever one is open. Which one is open lives in
// the URL (`?checklist=6`), so the Milestones tab's "Verify checklist" and a
// shared link land on the same record.

export const CHECKLIST_PARAM = "checklist";

export function ProjectChecklistsTab({
  project,
  isAdmin,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ChecklistsTab project={project} isAdmin={isAdmin} />
    </QueryClientProvider>
  );
}

function ChecklistsTab({
  project,
  isAdmin,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = Number(searchParams.get(CHECKLIST_PARAM));
  const open = Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : null;

  // replaceState, like the tab strip: the tab renders from its own queries,
  // and a router navigation would re-render the whole server page.
  const setOpen = useCallback(
    (number: number | null) => {
      const params = new URLSearchParams(window.location.search);
      params.set("activeTab", "checklists");
      if (number === null) params.delete(CHECKLIST_PARAM);
      else params.set(CHECKLIST_PARAM, String(number));
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname],
  );

  if (open !== null) {
    return (
      <ChecklistInspection
        projectId={project.id}
        number={open}
        isAdmin={isAdmin}
        onBack={() => setOpen(null)}
      />
    );
  }
  return <ChecklistOverview projectId={project.id} onOpen={setOpen} />;
}

function ChecklistOverview({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (number: number) => void;
}) {
  const query = useProjectChecklists(projectId);
  const [downloading, setDownloading] = useState<ChecklistSummary | null>(null);

  if (query.isPending) {
    return (
      <div
        className="grid gap-3"
        aria-busy="true"
        aria-label="Loading checklists"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertTitle>The checklists could not be loaded</AlertTitle>
        <AlertDescription>
          {query.error.message}
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => query.refetch()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="grid gap-4" aria-labelledby="checklists-heading">
      <div>
        <h2
          id="checklists-heading"
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <ClipboardCheck
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          Stage checklists
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One checklist per contract stage. Each stage on the Milestones tab
          opens its checklist with Verify checklist.
        </p>
      </div>

      <ul className="grid list-none gap-3">
        {query.data.map((checklist) => (
          <li key={checklist.id}>
            <ChecklistCard
              checklist={checklist}
              onOpen={() => onOpen(checklist.number)}
              onDownload={() => setDownloading(checklist)}
            />
          </li>
        ))}
      </ul>

      {downloading ? (
        <DownloadChecklistDialog
          open
          onOpenChange={(next) => {
            if (!next) setDownloading(null);
          }}
          projectId={projectId}
          checklist={{
            closed: downloading.status === "CLOSED",
            configured: downloading.progress.total > 0,
            id: downloading.id,
            title: downloading.title,
          }}
        />
      ) : null}
    </section>
  );
}

function ChecklistCard({
  checklist,
  onOpen,
  onDownload,
}: {
  checklist: ChecklistSummary;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const { progress } = checklist;
  const configured = progress.total > 0;
  const percent = configured
    ? Math.round((progress.reviewed / progress.total) * 100)
    : 0;

  return (
    <Card className="flex flex-col gap-3 rounded-xl border-border/70 p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            Checklist {checklist.number}
          </span>
          <StatusPill tone={DISPLAY_TONE[checklist.displayStatus]}>
            {CHECKLIST_STATUS_LABELS[checklist.displayStatus]}
          </StatusPill>
          {progress.openIssues > 0 ? (
            <StatusPill tone="danger">
              {progress.openIssues} open issue
              {progress.openIssues === 1 ? "" : "s"}
            </StatusPill>
          ) : null}
        </div>
        <h3 className="mt-1 truncate text-sm font-semibold text-foreground">
          {checklist.title}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {checklist.stageLabel} stage
          </span>
        </h3>
        {configured ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="font-mono tabular-nums">
                Reviewed {progress.reviewed}/{progress.total}
              </span>
              <span
                className="h-1 w-20 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    checklist.status === "CLOSED"
                      ? "bg-success-ink"
                      : "bg-warning-ink",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
            </span>
            <span>Updated {formatDateTime(checklist.updatedAt)}</span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No inspection items configured yet. It can be downloaded as a blank
            template.
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="size-4" aria-hidden="true" />
          Download
        </Button>
        <Button size="sm" onClick={onOpen}>
          Open
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
