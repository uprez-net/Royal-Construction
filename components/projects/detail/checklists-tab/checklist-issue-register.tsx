"use client";

import { ClipboardList } from "lucide-react";
import { FilterChip, FilterChips } from "@/components/common/list-toolbar";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import type { ChecklistDetail } from "@/lib/domain/projects/checklists";

import { IssueCard } from "./checklist-issue-card";

// The checklist's issue register (issue #420): every defect raised on it, its
// status, who it is with, whether they were told, and its history. Every move
// a reviewer can make on an issue is on its card, and only the moves the
// server will accept for its current status are offered.

type Filter = "blocking" | "all";

export function IssueRegister({
  checklist,
  projectId,
  readOnly,
}: {
  checklist: ChecklistDetail;
  projectId: string;
  readOnly: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(
    () =>
      filter === "all"
        ? checklist.issues
        : checklist.issues.filter((issue) => issue.status !== "VERIFIED"),
    [checklist.issues, filter],
  );

  return (
    <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ClipboardList
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          Issue register
          <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {checklist.issues.length}
          </span>
        </h3>
        {checklist.issues.length > 0 ? (
          <FilterChips
            role="group"
            aria-label="Filter issues"
            className="flex-none"
          >
            <FilterChip
              active={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </FilterChip>
            <FilterChip
              active={filter === "blocking"}
              onClick={() => setFilter("blocking")}
            >
              Not yet verified
            </FilterChip>
          </FilterChips>
        ) : null}
      </div>
      {checklist.issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues raised. Use Raise issue on any inspection row to record a
          defect and notify the tradie.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every issue has been verified and signed off.
        </p>
      ) : (
        <ul className="grid list-none gap-3">
          {shown.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              checklist={checklist}
              projectId={projectId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
